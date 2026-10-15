-- Ranch Tasks schema (Cloudflare D1 / SQLite)

CREATE TABLE users (
  id            INTEGER PRIMARY KEY AUTOINCREMENT,
  name          TEXT NOT NULL,
  username      TEXT NOT NULL UNIQUE COLLATE NOCASE,
  pass_hash     TEXT NOT NULL,
  pass_salt     TEXT NOT NULL,
  role          TEXT NOT NULL DEFAULT 'hand' CHECK (role IN ('owner', 'hand')),
  active        INTEGER NOT NULL DEFAULT 1,
  failed_logins INTEGER NOT NULL DEFAULT 0,
  locked_until  TEXT,
  created_at    TEXT NOT NULL DEFAULT (strftime('%Y-%m-%dT%H:%M:%fZ', 'now'))
);

CREATE TABLE sessions (
  token      TEXT PRIMARY KEY,
  user_id    INTEGER NOT NULL REFERENCES users(id) ON DELETE CASCADE,
  expires_at TEXT NOT NULL
);
CREATE INDEX idx_sessions_user ON sessions(user_id);

CREATE TABLE settings (
  key   TEXT PRIMARY KEY,
  value TEXT
);
INSERT INTO settings (key, value) VALUES
  ('ranch_name', 'Ranch Tasks'),
  ('timezone', 'America/Chicago'),
  ('week_start', '0'),          -- 0 = Sunday, 1 = Monday (payroll week)
  ('overtime_hours', '40'),
  ('payroll_email', ''),
  ('payroll_auto_email', '0'),
  ('map_lat', '36.0'),
  ('map_lng', '-95.0'),
  ('map_zoom', '14');

-- Reusable how-to instructions (equipment hookup, procedures, safety).
CREATE TABLE guides (
  id         INTEGER PRIMARY KEY AUTOINCREMENT,
  title      TEXT NOT NULL,
  category   TEXT NOT NULL DEFAULT 'Equipment',
  body       TEXT NOT NULL DEFAULT '',
  created_by INTEGER REFERENCES users(id),
  updated_by INTEGER REFERENCES users(id),
  created_at TEXT NOT NULL DEFAULT (strftime('%Y-%m-%dT%H:%M:%fZ', 'now')),
  updated_at TEXT NOT NULL DEFAULT (strftime('%Y-%m-%dT%H:%M:%fZ', 'now'))
);

-- A task. Recurring tasks stay 'open' and roll their due_date forward each
-- time they are completed; one-off tasks become 'done'.
CREATE TABLE tasks (
  id             INTEGER PRIMARY KEY AUTOINCREMENT,
  title          TEXT NOT NULL,
  description    TEXT NOT NULL DEFAULT '',
  guide_id       INTEGER REFERENCES guides(id) ON DELETE SET NULL,
  assigned_to    INTEGER REFERENCES users(id) ON DELETE SET NULL,
  priority       TEXT NOT NULL DEFAULT 'normal' CHECK (priority IN ('low', 'normal', 'high')),
  due_date       TEXT,                     -- YYYY-MM-DD (ranch local date), NULL = anytime
  recur_type     TEXT NOT NULL DEFAULT 'none' CHECK (recur_type IN ('none', 'daily', 'weekly', 'monthly', 'yearly')),
  recur_interval INTEGER NOT NULL DEFAULT 1,
  recur_weekdays TEXT NOT NULL DEFAULT '',  -- weekly only, e.g. '1,3,5' (0 = Sunday)
  recur_anchor   TEXT,                     -- first occurrence; schedule is computed from here
  est_minutes    INTEGER,
  lat            REAL,
  lng            REAL,
  location_name  TEXT NOT NULL DEFAULT '',
  status         TEXT NOT NULL DEFAULT 'open' CHECK (status IN ('open', 'done', 'archived')),
  created_by     INTEGER REFERENCES users(id),
  created_at     TEXT NOT NULL DEFAULT (strftime('%Y-%m-%dT%H:%M:%fZ', 'now')),
  updated_at     TEXT NOT NULL DEFAULT (strftime('%Y-%m-%dT%H:%M:%fZ', 'now'))
);
CREATE INDEX idx_tasks_status_due ON tasks(status, due_date);

-- Every time someone marks a task complete. Owners review these.
CREATE TABLE completions (
  id            INTEGER PRIMARY KEY AUTOINCREMENT,
  task_id       INTEGER NOT NULL REFERENCES tasks(id) ON DELETE CASCADE,
  task_title    TEXT NOT NULL,
  user_id       INTEGER NOT NULL REFERENCES users(id),
  completed_at  TEXT NOT NULL,
  completed_on  TEXT NOT NULL,             -- ranch local date
  due_date      TEXT,                      -- due date at the time it was completed
  minutes_spent INTEGER,
  notes         TEXT NOT NULL DEFAULT '',
  review_status TEXT NOT NULL DEFAULT 'pending' CHECK (review_status IN ('pending', 'approved', 'flagged')),
  reviewed_by   INTEGER REFERENCES users(id),
  reviewed_at   TEXT,
  review_note   TEXT NOT NULL DEFAULT ''
);
CREATE INDEX idx_completions_on ON completions(completed_on);
CREATE INDEX idx_completions_review ON completions(review_status);
CREATE INDEX idx_completions_task ON completions(task_id);

CREATE TABLE time_entries (
  id         INTEGER PRIMARY KEY AUTOINCREMENT,
  user_id    INTEGER NOT NULL REFERENCES users(id),
  clock_in   TEXT NOT NULL,                -- ISO UTC
  clock_out  TEXT,                         -- ISO UTC, NULL while on the clock
  work_date  TEXT NOT NULL,                -- ranch local date of clock_in
  in_lat     REAL,
  in_lng     REAL,
  out_lat    REAL,
  out_lng    REAL,
  note       TEXT NOT NULL DEFAULT '',
  edited_by  INTEGER REFERENCES users(id),
  created_at TEXT NOT NULL DEFAULT (strftime('%Y-%m-%dT%H:%M:%fZ', 'now'))
);
CREATE INDEX idx_time_user_date ON time_entries(user_id, work_date);
CREATE INDEX idx_time_date ON time_entries(work_date);

-- Map overlays imported from onX (KML/GPX export) or GeoJSON.
CREATE TABLE map_layers (
  id         INTEGER PRIMARY KEY AUTOINCREMENT,
  name       TEXT NOT NULL,
  color      TEXT NOT NULL DEFAULT '#ff7800',
  geojson    TEXT NOT NULL,
  visible    INTEGER NOT NULL DEFAULT 1,
  created_by INTEGER REFERENCES users(id),
  created_at TEXT NOT NULL DEFAULT (strftime('%Y-%m-%dT%H:%M:%fZ', 'now'))
);
