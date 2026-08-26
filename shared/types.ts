import { z } from "zod";

export const ScenarioSchema = z.enum([
  "happy",
  "userToken",
  "serviceToken",
  "kafkaDown",
  "creditMissing"
]);

export type Scenario = z.infer<typeof ScenarioSchema>;

export const RequestSchema = z.object({
  scenario: ScenarioSchema.default("happy")
});

export const ApplicationEventSchema = z.object({
  applicationId: z.string().uuid(),
  traceId: z.string().min(8),
  scenario: ScenarioSchema,
  createdAt: z.string().datetime()
});

export type ApplicationEvent = z.infer<typeof ApplicationEventSchema>;

export type TraceStatus = "success" | "warning" | "error";

export type TraceEvent = {
  component: "web" | "bff" | "api" | "orch" | "kafka" | "parser";
  event: string;
  detail: string;
  status: TraceStatus;
  durationMs: number;
  timestamp: string;
};

export type TraceResponse = {
  applicationId?: string;
  traceId: string;
  status: string;
  scenario: Scenario;
  events: TraceEvent[];
  creditResult?: { decision: string; scoreBand: string } | null;
  error?: string;
};

export function traceEvent(
  component: TraceEvent["component"],
  event: string,
  detail: string,
  status: TraceStatus = "success",
  durationMs = 0
): TraceEvent {
  return {
    component,
    event,
    detail,
    status,
    durationMs,
    timestamp: new Date().toISOString()
  };
}
