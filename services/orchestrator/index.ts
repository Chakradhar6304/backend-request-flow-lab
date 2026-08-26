import Fastify from "fastify";
import { randomUUID } from "node:crypto";
import { verifyBearer } from "../../shared/auth.js";
import { config } from "../../shared/config.js";
import {
  createApplication,
  getTrace,
  recordTraceEvent,
  updateApplicationStatus
} from "../../shared/database.js";
import { applicationTopic, kafka } from "../../shared/kafka.js";
import { startTelemetry, withSpan } from "../../shared/telemetry.js";
import {
  RequestSchema,
  traceEvent,
  type ApplicationEvent,
  type TraceEvent,
  type TraceResponse
} from "../../shared/types.js";

startTelemetry("workflow-orchestrator");

const app = Fastify({ logger: true });
const producer = kafka.producer();

app.addHook("onReady", async () => producer.connect());
app.addHook("onClose", async () => producer.disconnect());

app.get("/health", async () => ({ service: "orchestrator", status: "ok" }));

app.post("/v1/workflows", async (request, reply) => {
  const parsed = RequestSchema.safeParse(request.body ?? {});
  if (!parsed.success) return reply.code(400).send({ error: parsed.error.flatten() });

  const traceId = request.headers["x-trace-id"] as string;
  try {
    await verifyBearer(
      request.headers.authorization,
      "workflow-orchestrator",
      config.serviceTokenSecret,
      "service"
    );
  } catch {
    return reply.code(401).send({ error: "Invalid service token", traceId });
  }

  return withSpan(
    "workflow-orchestrator",
    "orchestrator.execute_workflow",
    { "trace.id": traceId, scenario: parsed.data.scenario },
    async () => {
      const applicationId = randomUUID();
      const startedAt = performance.now();
      await createApplication(applicationId, traceId, parsed.data.scenario);

      const events: TraceEvent[] = [];
      const workflowEvent = traceEvent(
        "orch",
        "Persist workflow state",
        "Created the application record and began workflow coordination.",
        "success",
        Math.round(performance.now() - startedAt)
      );
      events.push(workflowEvent);
      await recordTraceEvent(traceId, workflowEvent);

      if (parsed.data.scenario === "creditMissing") {
        const missingEvent = traceEvent(
          "orch",
          "Downstream result missing",
          "The workflow completed without the expected credit result.",
          "warning",
          Math.round(performance.now() - startedAt)
        );
        events.push(missingEvent);
        await recordTraceEvent(traceId, missingEvent);
        await updateApplicationStatus(traceId, "degraded");
        return reply.code(200).send({
          applicationId,
          traceId,
          scenario: parsed.data.scenario,
          status: "degraded",
          creditResult: null,
          events
        } satisfies TraceResponse);
      }

      if (parsed.data.scenario === "kafkaDown") {
        const kafkaEvent = traceEvent(
          "kafka",
          "Publish failed",
          "Fault injection simulated an unavailable Kafka broker.",
          "error",
          Math.round(performance.now() - startedAt)
        );
        events.push(kafkaEvent);
        await recordTraceEvent(traceId, kafkaEvent);
        await updateApplicationStatus(traceId, "event_publish_failed");
        return reply.code(503).send({
          applicationId,
          traceId,
          scenario: parsed.data.scenario,
          status: "event_publish_failed",
          error: "Kafka publish failed",
          events
        } satisfies TraceResponse);
      }

      const message: ApplicationEvent = {
        applicationId,
        traceId,
        scenario: parsed.data.scenario,
        createdAt: new Date().toISOString()
      };
      await producer.send({
        topic: applicationTopic,
        messages: [{ key: applicationId, value: JSON.stringify(message) }]
      });

      const kafkaEvent = traceEvent(
        "kafka",
        "Publish application event",
        `Published to ${applicationTopic} for asynchronous processing.`,
        "success",
        Math.round(performance.now() - startedAt)
      );
      events.push(kafkaEvent);
      await recordTraceEvent(traceId, kafkaEvent);
      await updateApplicationStatus(traceId, "event_published");

      return reply.code(202).send({
        applicationId,
        traceId,
        scenario: parsed.data.scenario,
        status: "event_published",
        creditResult: { decision: "proceed", scoreBand: "demo" },
        events
      } satisfies TraceResponse);
    }
  );
});

app.get("/v1/traces/:traceId", async (request, reply) => {
  const { traceId } = request.params as { traceId: string };
  try {
    await verifyBearer(
      request.headers.authorization,
      "workflow-orchestrator",
      config.serviceTokenSecret,
      "service"
    );
  } catch {
    return reply.code(401).send({ error: "Invalid service token", traceId });
  }

  const result = await getTrace(traceId);
  if (!result) return reply.code(404).send({ error: "Trace not found", traceId });
  return result;
});

await app.listen({ host: "0.0.0.0", port: 3003 });
