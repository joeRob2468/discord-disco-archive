/**
 * Schema migrations, applied in order and tracked with `PRAGMA user_version`.
 * Never edit a released migration; append a new one.
 *
 * Column naming: `recorded_*` columns mirror `session.json` and are overwritten on every
 * sync. Unprefixed editable columns (`title`, `display_name`, `description`, `hidden`)
 * belong to the archive and are never touched by sync; NULL means "use the recorded value".
 */
export const migrations: readonly string[] = [
  /* 1: initial schema */ `
  CREATE TABLE streamers (
    user_id             TEXT PRIMARY KEY,
    recorded_name       TEXT NOT NULL,
    avatar_url          TEXT,
    display_name        TEXT,
    bio                 TEXT,
    links               TEXT NOT NULL DEFAULT '[]', -- JSON array of URLs
    updated_at          TEXT
  ) STRICT;

  CREATE TABLE sessions (
    id                  TEXT PRIMARY KEY,
    dir                 TEXT NOT NULL UNIQUE,
    guild_id            TEXT NOT NULL,
    channel_id          TEXT NOT NULL,
    channel_name        TEXT NOT NULL,
    started_by_name     TEXT NOT NULL,
    started_at          TEXT NOT NULL,
    ended_at            TEXT,
    recorded_title      TEXT,
    title               TEXT,
    description         TEXT,
    hidden              INTEGER NOT NULL DEFAULT 0,
    missing             INTEGER NOT NULL DEFAULT 0, -- folder no longer on disk
    synced_at           TEXT NOT NULL,
    updated_at          TEXT
  ) STRICT;

  CREATE TABLE sets (
    id                  TEXT PRIMARY KEY,
    session_id          TEXT NOT NULL REFERENCES sessions(id) ON DELETE CASCADE,
    user_id             TEXT NOT NULL REFERENCES streamers(user_id),
    position            INTEGER NOT NULL,
    recorded_name       TEXT NOT NULL,
    started_at          TEXT NOT NULL,
    ended_at            TEXT,
    partial             INTEGER NOT NULL,
    status              TEXT NOT NULL,
    files               TEXT NOT NULL, -- JSON SetFiles, paths relative to the session dir
    recorded_hidden     INTEGER NOT NULL,
    title               TEXT,
    display_name        TEXT,
    description         TEXT,
    hidden              INTEGER, -- NULL = recorded_hidden
    missing             INTEGER NOT NULL DEFAULT 0,
    updated_at          TEXT
  ) STRICT;
  CREATE INDEX sets_session ON sets(session_id, position);
  CREATE INDEX sets_user ON sets(user_id, started_at);

  CREATE TABLE set_tags (
    set_id              TEXT NOT NULL REFERENCES sets(id) ON DELETE CASCADE,
    tag                 TEXT NOT NULL,
    PRIMARY KEY (set_id, tag)
  ) STRICT, WITHOUT ROWID;
  CREATE INDEX set_tags_tag ON set_tags(tag);

  CREATE TABLE audit_log (
    id                  INTEGER PRIMARY KEY,
    at                  TEXT NOT NULL,
    actor               TEXT NOT NULL,
    entity              TEXT NOT NULL,
    entity_id           TEXT NOT NULL,
    changes             TEXT NOT NULL -- JSON {field: {from, to}}
  ) STRICT;

  -- Effective values (edit > streamer default > recorded) live here, so every query
  -- resolves overrides the same way.
  CREATE VIEW set_view AS
  SELECT
    s.id, s.session_id, s.user_id, s.position, s.started_at, s.ended_at,
    s.partial, s.status, s.files, s.title, s.description, s.recorded_name,
    COALESCE(s.display_name, st.display_name, s.recorded_name) AS name,
    s.display_name AS edited_name, s.hidden AS hidden_override,
    st.avatar_url,
    COALESCE(s.hidden, s.recorded_hidden) AS hidden,
    (COALESCE(s.hidden, s.recorded_hidden) OR se.hidden OR s.missing OR se.missing) AS unlisted,
    COALESCE(se.title, se.recorded_title, se.channel_name) AS session_title,
    se.started_at AS session_started_at,
    se.dir AS session_dir,
    (SELECT group_concat(tag, ',') FROM set_tags t WHERE t.set_id = s.id) AS tags
  FROM sets s
  JOIN sessions se ON se.id = s.session_id
  JOIN streamers st ON st.user_id = s.user_id;

  CREATE VIEW session_view AS
  SELECT
    se.*,
    COALESCE(se.title, se.recorded_title, se.channel_name) AS display_title,
    (se.hidden OR se.missing) AS unlisted,
    (SELECT count(*) FROM sets s
      WHERE s.session_id = se.id AND NOT s.missing
        AND NOT COALESCE(s.hidden, s.recorded_hidden)) AS visible_sets,
    (SELECT count(*) FROM sets s WHERE s.session_id = se.id AND NOT s.missing) AS total_sets
  FROM sessions se;

  -- One row per set; rebuilt by catalog/search.ts. Session fields are denormalised in.
  CREATE VIRTUAL TABLE set_search USING fts5(
    set_id UNINDEXED,
    names, titles, description, tags,
    tokenize = 'unicode61 remove_diacritics 2'
  );
  `,
];
