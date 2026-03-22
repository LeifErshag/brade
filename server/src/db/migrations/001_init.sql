CREATE TABLE IF NOT EXISTS users (
  id             UUID        PRIMARY KEY DEFAULT gen_random_uuid(),
  oauth_provider VARCHAR(20) NOT NULL,
  oauth_id       VARCHAR(255) NOT NULL,
  display_name   VARCHAR(50) NOT NULL,
  avatar_url     TEXT,
  elo            INTEGER     NOT NULL DEFAULT 1200,
  wins           INTEGER     NOT NULL DEFAULT 0,
  losses         INTEGER     NOT NULL DEFAULT 0,
  created_at     TIMESTAMPTZ NOT NULL DEFAULT now(),
  UNIQUE (oauth_provider, oauth_id)
);

CREATE TABLE IF NOT EXISTS games (
  id               UUID        PRIMARY KEY DEFAULT gen_random_uuid(),
  room_id          VARCHAR(8)  NOT NULL UNIQUE,
  white_id         UUID        REFERENCES users(id),
  black_id         UUID        REFERENCES users(id),
  winner_id        UUID        REFERENCES users(id),
  win_type         VARCHAR(20),
  monk             BOOLEAN     NOT NULL DEFAULT false,
  white_score      INTEGER     NOT NULL DEFAULT 0,
  black_score      INTEGER     NOT NULL DEFAULT 0,
  match_length     INTEGER     NOT NULL DEFAULT 5,
  white_elo_before INTEGER,
  black_elo_before INTEGER,
  white_elo_after  INTEGER,
  black_elo_after  INTEGER,
  started_at       TIMESTAMPTZ NOT NULL DEFAULT now(),
  ended_at         TIMESTAMPTZ
);

CREATE TABLE IF NOT EXISTS moves (
  id       BIGSERIAL   PRIMARY KEY,
  game_id  UUID        NOT NULL REFERENCES games(id) ON DELETE CASCADE,
  seq      INTEGER     NOT NULL,
  color    VARCHAR(5)  NOT NULL,
  from_pt  VARCHAR(4)  NOT NULL,
  to_pt    VARCHAR(4)  NOT NULL,
  die      INTEGER     NOT NULL,
  force    BOOLEAN     NOT NULL DEFAULT false,
  ts       TIMESTAMPTZ NOT NULL DEFAULT now()
);

CREATE INDEX IF NOT EXISTS games_white_id_idx ON games(white_id);
CREATE INDEX IF NOT EXISTS games_black_id_idx ON games(black_id);
CREATE INDEX IF NOT EXISTS moves_game_id_idx  ON moves(game_id);
