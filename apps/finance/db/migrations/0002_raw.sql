-- 0002_raw.sql
--
-- The raw layer (PRD §7.2): exactly what the APIs returned, never hand-edited.
--
--   finance.raw_record         — one row per source object (both APIs, every entity).
--                                Upserted by (source, entity, external_id); the full
--                                payload is kept so staging can be rebuilt any time.
--   finance.raw_record_version — the previous payload, saved whenever a record's
--                                payload_hash changes (refunds, reschedules, edits).
--   finance.transform_error    — payloads `transform` couldn't map (Phase 5); created
--                                here so the raw layer and its error log ship together.
--
-- window_date (not in PRD v2; added in v3): the studio-local date an extract
-- window selects the record by — e.g. an appointment's class date. After a window
-- is re-pulled, rows inside it that weren't returned get missing_since set.
--
-- Privacy: payloads contain client PII. RLS on, no policies; API roles revoked.

CREATE TABLE finance.raw_record (
  id                  bigserial   PRIMARY KEY,
  source              text        NOT NULL CHECK (source IN ('acuity', 'square')),
  entity              text        NOT NULL,            -- 'appointment', 'appointment_payment', 'order', 'payment', …
  external_id         text        NOT NULL,            -- the source system's id (or a derived stable key, see raw/repo.ts)
  parent_external_id  text,                            -- e.g. the Acuity appointment id for an appointment_payment
  payload             jsonb       NOT NULL,            -- full API object, untouched
  payload_hash        text        NOT NULL,            -- sha256 of canonical JSON; same hash = nothing to write
  source_created_at   timestamptz,
  source_updated_at   timestamptz,
  window_date         date,                            -- LA date the extract window selects by (null = not windowed)
  first_seen_at       timestamptz NOT NULL DEFAULT now(),
  last_seen_at        timestamptz NOT NULL DEFAULT now(),
  missing_since       timestamptz,                     -- set when a re-pulled window no longer returns it
  last_sync_run_id    bigint      NOT NULL REFERENCES finance.sync_run (id),
  UNIQUE (source, entity, external_id)                 -- the upsert target
);
CREATE INDEX raw_record_entity_created_idx ON finance.raw_record (source, entity, source_created_at);
CREATE INDEX raw_record_entity_window_idx  ON finance.raw_record (source, entity, window_date);
CREATE INDEX raw_record_parent_idx         ON finance.raw_record (source, entity, parent_external_id);
CREATE INDEX raw_record_payload_gin        ON finance.raw_record USING gin (payload jsonb_path_ops); -- ad-hoc JSON queries

CREATE TABLE finance.raw_record_version (
  id             bigserial   PRIMARY KEY,
  raw_record_id  bigint      NOT NULL REFERENCES finance.raw_record (id),
  payload        jsonb       NOT NULL,
  payload_hash   text        NOT NULL,
  superseded_at  timestamptz NOT NULL DEFAULT now()
);
CREATE INDEX raw_record_version_record_idx ON finance.raw_record_version (raw_record_id);

CREATE TABLE finance.transform_error (
  id             bigserial   PRIMARY KEY,
  raw_record_id  bigint      NOT NULL REFERENCES finance.raw_record (id),
  entity         text        NOT NULL,
  message        text        NOT NULL,
  sync_run_id    bigint      REFERENCES finance.sync_run (id),
  created_at     timestamptz NOT NULL DEFAULT now()
);

ALTER TABLE finance.raw_record         ENABLE ROW LEVEL SECURITY;
ALTER TABLE finance.raw_record_version ENABLE ROW LEVEL SECURITY;
ALTER TABLE finance.transform_error    ENABLE ROW LEVEL SECURITY;

-- Same guarded revoke as 0001: new tables don't inherit the earlier REVOKE.
DO $$
BEGIN
  IF EXISTS (SELECT 1 FROM pg_roles WHERE rolname = 'anon') THEN
    REVOKE ALL ON ALL TABLES IN SCHEMA finance FROM anon;
  END IF;
  IF EXISTS (SELECT 1 FROM pg_roles WHERE rolname = 'authenticated') THEN
    REVOKE ALL ON ALL TABLES IN SCHEMA finance FROM authenticated;
  END IF;
END
$$;
