import Fastify from "fastify";
import {
  recordTraceEvent,
  updateApplicationStatus
} from "../../shared/database.js";
import { applicationTopic, kafka } from "../../shared/kafka.js";
import { startTelemetry, withSpan } from "../../shared/telemetry.js";
import {
  ApplicationEventSchema,
  traceEvent
} from "../../shared/types.js";

startTelemetry("application-event-worker");

const health = Fastify({ logger: true });
const consumer = kafka.consumer({ groupId: "request-flow-worker-v1" });

await consumer.connect();
await consumer.subscribe({ topic: applicationTopic, fromBeginning: false });

await consumer.run({
  eachMessage: async ({ message }) => {
    if (!message.value) return;
    const parsed = ApplicationEventSchema.safeParse(
      JSON.parse(message.value.toString())
    );
    if (!parsed.success) {
      health.log.error({ validation: parsed.error.flatten() }, "Invalid Kafka event");
      return;
    }

    const event = parsed.data;
    await withSpan(
      "application-event-worker",
      "worker.process_application_event",
      { "trace.id": event.traceId, "application.id": event.applicationId },
      async () => {
        const startedAt = performance.now();
        await new Promise((resolve) => setTimeout(resolve, 350));
        const processed = traceEvent(
          "parser",
          "Consume and process event",
          `Consumer group request-flow-worker-v1 processed ${applicationTopic}.`,
          "success",
          Math.round(performance.now() - startedAt)
        );
        await recordTraceEvent(event.traceId, processed);
        await updateApplicationStatus(event.traceId, "completed");
        health.log.info(
          { traceId: event.traceId, applicationId: event.applicationId },
          "Application event processed"
        );
      }
    );
  }
});

health.get("/health", async () => ({ service: "worker", status: "ok" }));
health.addHook("onClose", async () => consumer.disconnect());
await health.listen({ host: "0.0.0.0", port: 3004 });
