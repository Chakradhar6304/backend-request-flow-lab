import { SignJWT, jwtVerify } from "jose";

const encoder = new TextEncoder();

async function signToken(
  subject: string,
  audience: string,
  secret: string,
  kind: "user" | "service"
): Promise<string> {
  return new SignJWT({ kind })
    .setProtectedHeader({ alg: "HS256" })
    .setSubject(subject)
    .setIssuer("request-flow-lab")
    .setAudience(audience)
    .setIssuedAt()
    .setExpirationTime("15m")
    .sign(encoder.encode(secret));
}

export function issueUserToken(secret: string): Promise<string> {
  return signToken("demo-user", "request-flow-bff", secret, "user");
}

export function issueServiceToken(
  subject: string,
  audience: string,
  secret: string
): Promise<string> {
  return signToken(subject, audience, secret, "service");
}

export async function verifyBearer(
  authorization: string | undefined,
  audience: string,
  secret: string,
  expectedKind: "user" | "service"
): Promise<void> {
  if (!authorization?.startsWith("Bearer ")) {
    throw new Error("Missing bearer token");
  }

  const token = authorization.slice("Bearer ".length);
  const { payload } = await jwtVerify(token, encoder.encode(secret), {
    issuer: "request-flow-lab",
    audience
  });

  if (payload.kind !== expectedKind) {
    throw new Error(`Expected a ${expectedKind} token`);
  }
}
