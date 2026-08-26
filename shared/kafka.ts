import { Kafka, logLevel } from "kafkajs";
import { config } from "./config.js";

export const kafka = new Kafka({
  clientId: "request-flow-lab",
  brokers: config.kafkaBrokers,
  logLevel: logLevel.WARN,
  retry: { initialRetryTime: 300, retries: 10 }
});

export const applicationTopic = "application.created.v1";
