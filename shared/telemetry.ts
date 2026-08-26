import {
  context,
  SpanStatusCode,
  trace,
  type Attributes
} from "@opentelemetry/api";
import { getNodeAutoInstrumentations } from "@opentelemetry/auto-instrumentations-node";
import { OTLPTraceExporter } from "@opentelemetry/exporter-trace-otlp-http";
import { resourceFromAttributes } from "@opentelemetry/resources";
import { NodeSDK } from "@opentelemetry/sdk-node";
import { config } from "./config.js";

let sdk: NodeSDK | undefined;

export function startTelemetry(serviceName: string): void {
  if (process.env.OTEL_DISABLED === "true") return;

  sdk = new NodeSDK({
    resource: resourceFromAttributes({ "service.name": serviceName }),
    traceExporter: new OTLPTraceExporter({
      url: `${config.otlpEndpoint.replace(/\/$/, "")}/v1/traces`
    }),
    instrumentations: [getNodeAutoInstrumentations()]
  });
  sdk.start();

  const shutdown = async () => {
    await sdk?.shutdown();
    process.exit(0);
  };
  process.once("SIGTERM", shutdown);
  process.once("SIGINT", shutdown);
}

export async function withSpan<T>(
  serviceName: string,
  spanName: string,
  attributes: Attributes,
  operation: () => Promise<T>
): Promise<T> {
  const tracer = trace.getTracer(serviceName);
  const span = tracer.startSpan(spanName, { attributes });

  return context.with(trace.setSpan(context.active(), span), async () => {
    try {
      const result = await operation();
      span.setStatus({ code: SpanStatusCode.OK });
      return result;
    } catch (error) {
      span.recordException(error as Error);
      span.setStatus({
        code: SpanStatusCode.ERROR,
        message: error instanceof Error ? error.message : "Unknown error"
      });
      throw error;
    } finally {
      span.end();
    }
  });
}
