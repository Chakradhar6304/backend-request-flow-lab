import cors from "@fastify/cors";
import Fastify from "fastify";
import { randomUUID } from "node:crypto";
import {
  issueServiceToken,
  issueUserToken,
  verifyBearer
} from "../../shared/auth.js";
import { config } from "../../shared/config.js";
import { callService } from "../../shared/http.js";
import { startTelemetry, withSpan } from "../../shared/telemetry.js";
import {
  RequestSchema,
  traceEvent,
  type TraceResponse
} from "../../shared/types.js";

startTelemetry("request-flow-bff");

const app = Fastify({ logger: true });
await app.register(cors, { origin: config.webOrigin });

app.get("/health", async () => ({ service: "bff", status: "ok" }));

app.post("/api/demo-token", async () => ({
  token: await issueUserToken(config.userTokenSecret),
  expiresIn: 900
}));

app.post("/api/requests", async (request, reply) => {
  const parsed = RequestSchema.safeParse(request.body ?? {});
  if (!parsed.success) {
    return reply.code(400).send({ error: parsed.error.flatten() });
  }

  const traceId =
    (request.headers["x-trace-id"] as string | undefined) ??
    `trc_${randomUUID().replaceAll("-", "").slice(0, 16)}`;
  const startedAt = performance.now();

  try {
    await verifyBearer(
      request.headers.authorization,
      "request-flow-bff",
      config.userTokenSecret,
      "user"
    );
  } catch (error) {
    const event = traceEvent(
      "bff",
      "Reject user token",
      error instanceof Error ? error.message : "User token validation failed",
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
    "request-flow-bff",
    "bff.forward_application",
    { "trace.id": traceId, scenario: parsed.data.scenario },
    async () => {
      const tokenSecret =
        parsed.data.scenario === "serviceToken"
          ? "intentionally-wrong-service-secret"
          : config.serviceTokenSecret;
      const serviceToken = await issueServiceToken(
        "request-flow-bff",
        "application-api",
        tokenSecret
      );

      const result = await callService(
        `${config.applicationApiUrl}/v1/applications`,
        "POST",
        serviceToken,
        traceId,
        parsed.data
      );
      const bffEvent = traceEvent(
        "bff",
        "Validate user and forward",
        "Validated the user JWT and called the Application API with a service JWT.",
        result.status < 400 ? "success" : "warning",
        Math.round(performance.now() - startedAt)
      );

      return reply.code(result.status).send({
        ...result.payload,
        traceId,
        events: [bffEvent, ...(result.payload.events ?? [])]
      });
    }
  );
});

app.get("/api/traces/:traceId", async (request, reply) => {
  const { traceId } = request.params as { traceId: string };
  try {
    await verifyBearer(
      request.headers.authorization,
      "request-flow-bff",
      config.userTokenSecret,
      "user"
    );
  } catch {
    return reply.code(401).send({ error: "Invalid user token", traceId });
  }

  const serviceToken = await issueServiceToken(
    "request-flow-bff",
    "application-api",
    config.serviceTokenSecret
  );
  const result = await callService(
    `${config.applicationApiUrl}/v1/traces/${traceId}`,
    "GET",
    serviceToken,
    traceId
  );
  return reply.code(result.status).send(result.payload);
});

await app.listen({ host: "0.0.0.0", port: 3001 });
