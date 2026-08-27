import pg from "pg";
import { config } from "./config.js";
import type { MetricsResponse, Scenario, TraceEvent } from "./types.js";

const { Pool } = pg;
export const pool = new Pool({ connectionString: config.databaseUrl });

export async function ensureSchema(): Promise<void> {
  await pool.query(`
    CREATE TABLE IF NOT EXISTS applications (
      id UUID PRIMARY KEY,
      trace_id TEXT NOT NULL UNIQUE,
      scenario TEXT NOT NULL,
      status TEXT NOT NULL,
      created_at TIMESTAMPTZ NOT NULL DEFAULT NOW(),
      updated_at TIMESTAMPTZ NOT NULL DEFAULT NOW()
    );

    CREATE TABLE IF NOT EXISTS trace_events (
      id BIGSERIAL PRIMARY KEY,
      trace_id TEXT NOT NULL,
      component TEXT NOT NULL,
      event TEXT NOT NULL,
      detail TEXT NOT NULL,
      status TEXT NOT NULL,
      duration_ms INTEGER NOT NULL DEFAULT 0,
      created_at TIMESTAMPTZ NOT NULL DEFAULT NOW()
    );

    CREATE INDEX IF NOT EXISTS trace_events_trace_id_idx
      ON trace_events (trace_id, created_at);
  `);
}

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

export async function getMetrics(): Promise<MetricsResponse> {
  const result = await pool.query(`
    WITH trace_durations AS (
      SELECT trace_id, SUM(duration_ms)::INTEGER AS total_duration_ms
      FROM trace_events
      GROUP BY trace_id
    )
    SELECT
      COUNT(*)::INTEGER AS total_requests,
      COUNT(*) FILTER (WHERE status = 'completed')::INTEGER AS completed,
      COUNT(*) FILTER (WHERE status = 'degraded')::INTEGER AS degraded,
      COUNT(*) FILTER (WHERE status = 'event_publish_failed')::INTEGER AS failed,
      COUNT(*) FILTER (WHERE status IN ('started', 'event_published'))::INTEGER AS in_progress,
      COALESCE(
        PERCENTILE_CONT(0.95) WITHIN GROUP (ORDER BY trace_durations.total_duration_ms),
        0
      )::INTEGER AS p95_duration_ms
    FROM applications
    LEFT JOIN trace_durations USING (trace_id)
  `);

  const row = result.rows[0];
  const totalRequests = Number(row.total_requests);
  const completed = Number(row.completed);

  return {
    totalRequests,
    completed,
    degraded: Number(row.degraded),
    failed: Number(row.failed),
    inProgress: Number(row.in_progress),
    successRate:
      totalRequests === 0 ? 0 : Math.round((completed / totalRequests) * 1000) / 10,
    p95DurationMs: Number(row.p95_duration_ms)
  };
}
