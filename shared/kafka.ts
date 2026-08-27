import { Kafka, logLevel } from "kafkajs";
import { config } from "./config.js";

export const kafka = new Kafka({
  clientId: "request-flow-lab",
  brokers: config.kafkaBrokers,
  ssl: config.kafkaSsl
    ? config.kafkaCaCert
      ? { ca: [config.kafkaCaCert] }
      : true
    : undefined,
  sasl:
    config.kafkaUsername && config.kafkaPassword
      ? {
          mechanism: "scram-sha-256",
          username: config.kafkaUsername,
          password: config.kafkaPassword
        }
      : undefined,
  logLevel: logLevel.WARN,
  retry: { initialRetryTime: 300, retries: 10 }
});

export const applicationTopic = "application.created.v1";
