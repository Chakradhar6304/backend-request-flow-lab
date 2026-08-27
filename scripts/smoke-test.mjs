const bffUrl = process.env.BFF_URL ?? "http://localhost:3001";

let healthy = false;
for (let attempt = 0; attempt < 60; attempt += 1) {
  try {
    const response = await fetch(`${bffUrl}/health`);
    if (response.ok) {
      healthy = true;
      break;
    }
  } catch {
    // Services are still starting.
  }
  await new Promise((resolve) => setTimeout(resolve, 1000));
}
if (!healthy) throw new Error("BFF did not become healthy within 60 seconds");

const apiHealthResponse = await fetch(`${bffUrl}/api/health`);
if (!apiHealthResponse.ok) throw new Error("Public API health route is unavailable");

const webResponse = await fetch(bffUrl);
if (!webResponse.ok || !(await webResponse.text()).includes("Backend Request Flow Lab")) {
  throw new Error("BFF did not serve the production React application");
}

const tokenResponse = await fetch(`${bffUrl}/api/demo-token`, { method: "POST" });
if (!tokenResponse.ok) throw new Error("Could not obtain the demo user token");
const { token } = await tokenResponse.json();

async function runScenario(scenario, expectedStatus, authorization = token) {
  const response = await fetch(`${bffUrl}/api/requests`, {
    method: "POST",
    headers: {
      authorization: `Bearer ${authorization}`,
      "content-type": "application/json"
    },
    body: JSON.stringify({ scenario })
  });
  const payload = await response.json();
  if (response.status !== expectedStatus) {
    throw new Error(
      `${scenario}: expected ${expectedStatus}, received ${response.status}: ${JSON.stringify(payload)}`
    );
  }
  return payload;
}

const created = await runScenario("happy", 202);
console.log(`Created ${created.applicationId} with trace ${created.traceId}`);

let trace;
for (let attempt = 0; attempt < 15; attempt += 1) {
  await new Promise((resolve) => setTimeout(resolve, 400));
  const response = await fetch(`${bffUrl}/api/traces/${created.traceId}`, {
    headers: { authorization: `Bearer ${token}` }
  });
  if (response.ok) trace = await response.json();
  if (trace?.status === "completed") break;
}

if (trace?.status !== "completed") {
  throw new Error(`Trace did not complete: ${JSON.stringify(trace)}`);
}

await runScenario("userToken", 401, "invalid-user-token");
await runScenario("serviceToken", 401);
await runScenario("kafkaDown", 503);
await runScenario("creditMissing", 200);

const metricsResponse = await fetch(`${bffUrl}/api/metrics`);
if (!metricsResponse.ok) throw new Error("Metrics endpoint is unavailable");
const metrics = await metricsResponse.json();
if (
  metrics.totalRequests < 3 ||
  metrics.completed < 1 ||
  metrics.degraded < 1 ||
  metrics.failed < 1
) {
  throw new Error(`Metrics did not include every persisted outcome: ${JSON.stringify(metrics)}`);
}

console.log(
  `Smoke test passed: ${trace.events.length} trace events, five scenarios, ${metrics.totalRequests} measured requests.`
);
