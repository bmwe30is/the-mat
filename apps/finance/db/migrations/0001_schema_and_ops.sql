-- 0001_schema_and_ops.sql
--
-- Creates the operational tables every CLI command uses:
--   finance.sync_run    — one row per command run (migrate, extract, transform, …),
--                         so we can see what ran, over which window, and how it went.
--   finance.sync_cursor — small key/value store for resumable extraction
--                         (e.g. "last completed month for Acuity appointments").
--
-- The `finance` schema itself and `finance.schema_migrations` are created by the
-- migration runner (src/db/migrate.ts) before this file runs.
--
-- Privacy: every table has row-level security ENABLED with NO policies. Supabase's
-- anon/authenticated API roles therefore see nothing, even if someone later adds
-- `finance` to the Data API's exposed schemas. The CLI connects as the database
-- owner, which bypasses RLS.

CREATE TABLE finance.sync_run (
  id              bigserial PRIMARY KEY,
  job             text        NOT NULL,                 -- 'migrate', 'extract', 'transform', 'reconcile', 'check', 'run', 'probe'
  source          text        CHECK (source IN ('acuity', 'square')),  -- null for jobs not tied to one API
  window_start    date,                                 -- LA local date, inclusive
  window_end      date,                                 -- LA local date, inclusive
  status          text        NOT NULL DEFAULT 'running'
                              CHECK (status IN ('running', 'succeeded', 'failed')),
  started_at      timestamptz NOT NULL DEFAULT now(),
  finished_at     timestamptz,
  api_calls       integer     NOT NULL DEFAULT 0,
  rows_new        integer     NOT NULL DEFAULT 0,
  rows_changed    integer     NOT NULL DEFAULT 0,
  rows_unchanged  integer     NOT NULL DEFAULT 0,
  error           text
);
CREATE INDEX sync_run_job_started_idx ON finance.sync_run (job, started_at DESC);

CREATE TABLE finance.sync_cursor (
  key         text PRIMARY KEY,
  value       text        NOT NULL,
  updated_at  timestamptz NOT NULL DEFAULT now()
);

ALTER TABLE finance.sync_run    ENABLE ROW LEVEL SECURITY;
ALTER TABLE finance.sync_cursor ENABLE ROW LEVEL SECURITY;

-- Defense in depth beside "not exposed in the Data API": the Supabase API roles
-- get no access to the schema at all. Guarded so this also runs on plain Postgres
-- (e.g. a local test database) where these roles don't exist.
DO $$
BEGIN
  IF EXISTS (SELECT 1 FROM pg_roles WHERE rolname = 'anon') THEN
    REVOKE ALL ON SCHEMA finance FROM anon;
    REVOKE ALL ON ALL TABLES IN SCHEMA finance FROM anon;
  END IF;
  IF EXISTS (SELECT 1 FROM pg_roles WHERE rolname = 'authenticated') THEN
    REVOKE ALL ON SCHEMA finance FROM authenticated;
    REVOKE ALL ON ALL TABLES IN SCHEMA finance FROM authenticated;
  END IF;
END
$$;
