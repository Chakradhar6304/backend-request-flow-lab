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
