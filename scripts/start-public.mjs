import { spawn } from "node:child_process";

const publicPort = process.env.PORT ?? "3001";
const sharedEnvironment = {
  ...process.env,
  APPLICATION_API_URL: process.env.APPLICATION_API_URL ?? "http://127.0.0.1:3002",
  ORCHESTRATOR_URL: process.env.ORCHESTRATOR_URL ?? "http://127.0.0.1:3003",
  SERVE_WEB: "true",
  OTEL_DISABLED: process.env.OTEL_DISABLED ?? "true"
};

const definitions = [
  ["orchestrator", "backend-dist/services/orchestrator/index.js", "3003"],
  ["application-api", "backend-dist/services/application-api/index.js", "3002"],
  ["worker", "backend-dist/services/worker/index.js", "3004"],
  ["bff", "backend-dist/services/bff/index.js", publicPort]
];

const children = [];
let stopping = false;

function shutdown(exitCode = 0) {
  if (stopping) return;
  stopping = true;
  for (const child of children) child.kill("SIGTERM");
  setTimeout(() => process.exit(exitCode), 1500).unref();
}

for (const [name, entrypoint, port] of definitions) {
  const child = spawn(process.execPath, [entrypoint], {
    env: { ...sharedEnvironment, PORT: port },
    stdio: "inherit"
  });
  children.push(child);
  child.once("exit", (code, signal) => {
    if (stopping) return;
    console.error(`${name} stopped unexpectedly (${signal ?? code ?? "unknown"})`);
    shutdown(code || 1);
  });
}

process.once("SIGTERM", () => shutdown(0));
process.once("SIGINT", () => shutdown(0));
