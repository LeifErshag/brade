-- Problem reports sent from the "Report a problem" button (issue #141).
-- user_id has no foreign key: guests report too and have no users row.
-- Rows older than 90 days are deleted at server startup.
-- Players quote the first 8 characters of id (upper case) as the report ID:
--   SELECT * FROM support_reports WHERE id::text LIKE lower('ABCD1234') || '%';

CREATE TABLE IF NOT EXISTS support_reports (
  id          UUID        PRIMARY KEY DEFAULT gen_random_uuid(),
  created_at  TIMESTAMPTZ NOT NULL DEFAULT now(),
  user_id     UUID,
  is_guest    BOOLEAN     NOT NULL DEFAULT false,
  room_id     VARCHAR(8),
  note        TEXT        NOT NULL,
  page        TEXT,
  user_agent  TEXT,
  client      JSONB,      -- client state summary and recent client log lines
  server      JSONB       -- authoritative room snapshot at report time
);

CREATE INDEX IF NOT EXISTS support_reports_created_at_idx ON support_reports (created_at);
