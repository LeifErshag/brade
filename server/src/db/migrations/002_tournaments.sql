-- Phase 14: Tournament tables

CREATE TABLE IF NOT EXISTS tournaments (
  id              UUID         PRIMARY KEY DEFAULT gen_random_uuid(),
  name            VARCHAR(100) NOT NULL,
  creator_id      UUID         NOT NULL REFERENCES users(id),
  status          VARCHAR(20)  NOT NULL DEFAULT 'registration',
  tournament_type VARCHAR(20)  NOT NULL DEFAULT 'round_robin',
  match_length    INTEGER      NOT NULL DEFAULT 3,
  max_players     INTEGER      NOT NULL DEFAULT 8,
  current_round   INTEGER      NOT NULL DEFAULT 0,
  total_rounds    INTEGER,
  winner_id       UUID         REFERENCES users(id),
  created_at      TIMESTAMPTZ  NOT NULL DEFAULT now(),
  started_at      TIMESTAMPTZ,
  ended_at        TIMESTAMPTZ
);

-- status:          registration | active | finished | cancelled
-- tournament_type: round_robin  | single_elimination | swiss

CREATE TABLE IF NOT EXISTS tournament_players (
  tournament_id   UUID         NOT NULL REFERENCES tournaments(id) ON DELETE CASCADE,
  player_id       UUID         NOT NULL REFERENCES users(id),
  seed_elo        INTEGER      NOT NULL DEFAULT 1200,
  wins            INTEGER      NOT NULL DEFAULT 0,
  losses          INTEGER      NOT NULL DEFAULT 0,
  byes            INTEGER      NOT NULL DEFAULT 0,
  final_rank      INTEGER,
  status          VARCHAR(20)  NOT NULL DEFAULT 'active',
  joined_at       TIMESTAMPTZ  NOT NULL DEFAULT now(),
  PRIMARY KEY (tournament_id, player_id)
);

-- status: active | eliminated

CREATE TABLE IF NOT EXISTS tournament_matches (
  id              UUID         PRIMARY KEY DEFAULT gen_random_uuid(),
  tournament_id   UUID         NOT NULL REFERENCES tournaments(id) ON DELETE CASCADE,
  round           INTEGER      NOT NULL,
  room_id         VARCHAR(8),
  white_id        UUID         REFERENCES users(id),
  black_id        UUID         REFERENCES users(id),
  winner_id       UUID         REFERENCES users(id),
  status          VARCHAR(20)  NOT NULL DEFAULT 'pending',
  created_at      TIMESTAMPTZ  NOT NULL DEFAULT now(),
  completed_at    TIMESTAMPTZ
);

-- status: pending | playing | completed | bye

CREATE INDEX IF NOT EXISTS tournaments_status_idx         ON tournaments(status);
CREATE INDEX IF NOT EXISTS tournament_players_tid_idx     ON tournament_players(tournament_id);
CREATE INDEX IF NOT EXISTS tournament_matches_tid_idx     ON tournament_matches(tournament_id);
CREATE INDEX IF NOT EXISTS tournament_matches_room_id_idx ON tournament_matches(room_id);
