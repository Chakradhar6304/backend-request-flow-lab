import { describe, expect, it } from "vitest";
import {
  ApplicationEventSchema,
  RequestSchema,
  traceEvent
} from "../shared/types.js";

describe("request and event contracts", () => {
  it("defaults to the healthy scenario", () => {
    expect(RequestSchema.parse({}).scenario).toBe("happy");
  });

  it("rejects unknown failure scenarios", () => {
    expect(RequestSchema.safeParse({ scenario: "databaseExplodes" }).success).toBe(false);
  });

  it("validates Kafka application events", () => {
    const parsed = ApplicationEventSchema.safeParse({
      applicationId: "9e3ba11d-5af0-4600-9f6d-587986435af4",
      traceId: "trc_12345678",
      scenario: "happy",
      createdAt: new Date().toISOString()
    });
    expect(parsed.success).toBe(true);
  });

  it("creates timestamped trace events", () => {
    const event = traceEvent("api", "Validate", "Contract accepted", "success", 12);
    expect(event.durationMs).toBe(12);
    expect(event.timestamp).toMatch(/^\d{4}-\d{2}-\d{2}T/);
  });
});
