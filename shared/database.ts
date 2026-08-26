import pg from "pg";
import { config } from "./config.js";
import type { Scenario, TraceEvent } from "./types.js";

const { Pool } = pg;
export const pool = new Pool({ connectionString: config.databaseUrl });

export async function createApplication(
  id: string,
  traceId: string,
  scenario: Scenario
): Promise<void> {
  await pool.query(
    `INSERT INTO applications (id, trace_id, scenario, status)
     VALUES ($1, $2, $3, 'started')`,
    [id, traceId, scenario]
  );
}

export async function updateApplicationStatus(
  traceId: string,
  status: string
): Promise<void> {
  await pool.query(
    `UPDATE applications
     SET status = $2, updated_at = NOW()
     WHERE trace_id = $1`,
    [traceId, status]
  );
}

export async function recordTraceEvent(
  traceId: string,
  event: TraceEvent
): Promise<void> {
  await pool.query(
    `INSERT INTO trace_events
       (trace_id, component, event, detail, status, duration_ms, created_at)
     VALUES ($1, $2, $3, $4, $5, $6, $7)`,
    [
      traceId,
      event.component,
      event.event,
      event.detail,
      event.status,
      event.durationMs,
      event.timestamp
    ]
  );
}

export async function getTrace(traceId: string): Promise<{
  applicationId: string;
  traceId: string;
  scenario: Scenario;
  status: string;
  events: TraceEvent[];
} | null> {
  const application = await pool.query(
    `SELECT id, trace_id, scenario, status
     FROM applications WHERE trace_id = $1`,
    [traceId]
  );
  if (application.rowCount === 0) return null;

  const events = await pool.query(
    `SELECT component, event, detail, status, duration_ms, created_at
     FROM trace_events WHERE trace_id = $1 ORDER BY created_at, id`,
    [traceId]
  );

  const row = application.rows[0];
  return {
    applicationId: row.id,
    traceId: row.trace_id,
    scenario: row.scenario,
    status: row.status,
    events: events.rows.map((item) => ({
      component: item.component,
      event: item.event,
      detail: item.detail,
      status: item.status,
      durationMs: item.duration_ms,
      timestamp: new Date(item.created_at).toISOString()
    }))
  };
}
