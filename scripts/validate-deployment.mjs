import { readFile } from "node:fs/promises";

const blueprint = await readFile(new URL("../render.yaml", import.meta.url), "utf8");
const requiredFragments = [
  "plan: free",
  "dockerCommand: node scripts/start-public.mjs",
  "healthCheckPath: /api/health",
  "DATABASE_URL",
  "KAFKA_BROKERS",
  "KAFKA_USERNAME",
  "KAFKA_PASSWORD",
  "KAFKA_CA_CERT",
  "generateValue: true"
];

for (const fragment of requiredFragments) {
  if (!blueprint.includes(fragment)) {
    throw new Error(`render.yaml is missing required deployment setting: ${fragment}`);
  }
}

console.log("Free public deployment blueprint is complete.");
