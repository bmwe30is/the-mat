-- 0004_recon.sql
--
-- The reconciliation layer (PRD §7.4):
--   finance.recon_manual_override — HUMAN-owned. Applied first by `reconcile`,
--                                   never written or deleted by any job. Add rows
--                                   with plain SQL (see queries/README.md).
--   finance.recon_link            — derived: which Acuity record ⇄ which Square
--                                   payment, by which rule, with what evidence.
--   finance.recon_status          — derived: one row per Acuity record and per
--                                   Square payment in the window, with a status
--                                   and reason code.
-- recon_link and recon_status are deleted and rewritten in ONE transaction on
-- every `reconcile` run, so readers never see a half-built state.

CREATE TABLE finance.recon_manual_override (
  id                 bigserial   PRIMARY KEY,
  acuity_kind        text        NOT NULL CHECK (acuity_kind IN ('appointment', 'order')),
  acuity_id          text        NOT NULL,
  square_payment_id  text,                               -- NULL = "no Square payment expected"
  reason_code        text        NOT NULL,               -- e.g. 'COMP', 'GIFT_CARD', 'MANUAL_MATCH'
  note               text,
  created_at         timestamptz NOT NULL DEFAULT now()
);
CREATE INDEX recon_manual_override_acuity_idx ON finance.recon_manual_override (acuity_kind, acuity_id);

CREATE TABLE finance.recon_link (
  id                 bigserial   PRIMARY KEY,
  acuity_kind        text        NOT NULL CHECK (acuity_kind IN ('appointment', 'order', 'certificate')),
  acuity_id          text        NOT NULL,               -- appointment id, order id, or certificate code
  square_payment_id  text        NOT NULL,
  rule               text        NOT NULL,               -- '0' (manual), '1a', '1b', '2', '3', '4'
  confidence         text        NOT NULL CHECK (confidence IN ('manual', 'high', 'medium', 'low')),
  allocated_cents    bigint      NOT NULL,               -- this link's share of the Square payment
  evidence           jsonb       NOT NULL,               -- which fields matched, and how
  sync_run_id        bigint      REFERENCES finance.sync_run (id)
);
CREATE INDEX recon_link_acuity_idx ON finance.recon_link (acuity_kind, acuity_id);
CREATE INDEX recon_link_square_idx ON finance.recon_link (square_payment_id);

CREATE TABLE finance.recon_status (
  side            text    NOT NULL CHECK (side IN ('acuity', 'square')),
  kind            text    NOT NULL CHECK (kind IN ('appointment', 'order', 'payment')),
  id              text    NOT NULL,
  local_date      date,
  status          text    NOT NULL CHECK (status IN ('matched', 'amount_mismatch', 'acuity_only', 'square_only', 'not_applicable')),
  reason_code     text,
  exception       boolean NOT NULL,                      -- true = goes on the exceptions list
  expected_cents  bigint,
  actual_cents    bigint,
  delta_cents     bigint,                                -- actual - expected
  sync_run_id     bigint  REFERENCES finance.sync_run (id),
  PRIMARY KEY (side, kind, id)
);
CREATE INDEX recon_status_local_date_idx ON finance.recon_status (local_date);
CREATE INDEX recon_status_reason_idx     ON finance.recon_status (status, reason_code);

ALTER TABLE finance.recon_manual_override ENABLE ROW LEVEL SECURITY;
ALTER TABLE finance.recon_link            ENABLE ROW LEVEL SECURITY;
ALTER TABLE finance.recon_status          ENABLE ROW LEVEL SECURITY;

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
