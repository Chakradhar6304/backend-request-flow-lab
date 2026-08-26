import { describe, expect, it } from "vitest";
import {
  issueServiceToken,
  issueUserToken,
  verifyBearer
} from "../shared/auth.js";

const secret = "test-secret-that-is-long-enough";

describe("token boundaries", () => {
  it("accepts a user token only at the BFF audience", async () => {
    const token = await issueUserToken(secret);
    await expect(
      verifyBearer(`Bearer ${token}`, "request-flow-bff", secret, "user")
    ).resolves.toBeUndefined();
    await expect(
      verifyBearer(`Bearer ${token}`, "application-api", secret, "user")
    ).rejects.toThrow();
  });

  it("rejects a service token when the audience is wrong", async () => {
    const token = await issueServiceToken("bff", "application-api", secret);
    await expect(
      verifyBearer(`Bearer ${token}`, "application-api", secret, "service")
    ).resolves.toBeUndefined();
    await expect(
      verifyBearer(`Bearer ${token}`, "workflow-orchestrator", secret, "service")
    ).rejects.toThrow();
  });
});
