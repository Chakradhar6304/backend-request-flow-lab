export const config = {
  databaseUrl:
    process.env.DATABASE_URL ??
    "postgres://requestflow:requestflow@localhost:5432/requestflow",
  kafkaBrokers: (process.env.KAFKA_BROKERS ?? "localhost:19092").split(","),
  kafkaSsl:
    process.env.KAFKA_SSL === "true" || Boolean(process.env.KAFKA_USERNAME),
  kafkaUsername: process.env.KAFKA_USERNAME,
  kafkaPassword: process.env.KAFKA_PASSWORD,
  kafkaCaCert: process.env.KAFKA_CA_CERT?.replaceAll("\\n", "\n"),
  userTokenSecret:
    process.env.USER_TOKEN_SECRET ?? "local-user-secret-change-me",
  serviceTokenSecret:
    process.env.SERVICE_TOKEN_SECRET ?? "local-service-secret-change-me",
  applicationApiUrl:
    process.env.APPLICATION_API_URL ?? "http://localhost:3002",
  orchestratorUrl:
    process.env.ORCHESTRATOR_URL ?? "http://localhost:3003",
  webOrigin: process.env.WEB_ORIGIN ?? "http://localhost:5173",
  otlpEndpoint:
    process.env.OTEL_EXPORTER_OTLP_ENDPOINT ?? "http://localhost:4318"
};
