import Fastify from "fastify";
import { issueServiceToken, verifyBearer } from "../../shared/auth.js";
import { config } from "../../shared/config.js";
import { callService } from "../../shared/http.js";
import { startTelemetry, withSpan } from "../../shared/telemetry.js";
import {
  RequestSchema,
  traceEvent,
  type TraceResponse
} from "../../shared/types.js";

startTelemetry("application-api");

const app = Fastify({ logger: true });

app.get("/health", async () => ({ service: "application-api", status: "ok" }));

app.post("/v1/applications", async (request, reply) => {
  const parsed = RequestSchema.safeParse(request.body ?? {});
  if (!parsed.success) return reply.code(400).send({ error: parsed.error.flatten() });

  const traceId = request.headers["x-trace-id"] as string;
  const startedAt = performance.now();
  try {
    await verifyBearer(
      request.headers.authorization,
      "application-api",
      config.serviceTokenSecret,
      "service"
    );
  } catch (error) {
    const event = traceEvent(
      "api",
      "Reject service token",
      error instanceof Error ? error.message : "Service token validation failed",
      "error",
      Math.round(performance.now() - startedAt)
    );
    return reply.code(401).send({
      traceId,
      scenario: parsed.data.scenario,
      status: "rejected",
      error: event.detail,
      events: [event]
    } satisfies TraceResponse);
  }

  return withSpan(
    "application-api",
    "application_api.start_workflow",
    { "trace.id": traceId, scenario: parsed.data.scenario },
    async () => {
      const token = await issueServiceToken(
        "application-api",
        "workflow-orchestrator",
        config.serviceTokenSecret
      );
      const result = await callService(
        `${config.orchestratorUrl}/v1/workflows`,
        "POST",
        token,
        traceId,
        parsed.data
      );
      const apiEvent = traceEvent(
        "api",
        "Validate contract and start workflow",
        "Validated the request contract and called the workflow orchestrator.",
        result.status < 400 ? "success" : "warning",
        Math.round(performance.now() - startedAt)
      );
      return reply.code(result.status).send({
        ...result.payload,
        events: [apiEvent, ...(result.payload.events ?? [])]
      });
    }
  );
});

app.get("/v1/traces/:traceId", async (request, reply) => {
  const { traceId } = request.params as { traceId: string };
  try {
    await verifyBearer(
      request.headers.authorization,
      "application-api",
      config.serviceTokenSecret,
      "service"
    );
  } catch {
    return reply.code(401).send({ error: "Invalid service token", traceId });
  }

  const token = await issueServiceToken(
    "application-api",
    "workflow-orchestrator",
    config.serviceTokenSecret
  );
  const result = await callService(
    `${config.orchestratorUrl}/v1/traces/${traceId}`,
    "GET",
    token,
    traceId
  );
  return reply.code(result.status).send(result.payload);
});

await app.listen({
  host: "0.0.0.0",
  port: Number(process.env.PORT ?? 3002)
});
