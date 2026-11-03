-- v2: property aerial photos replace the map, semi-monthly pay periods with
-- no overtime, 14-hour auto clock-out, and an audit log of time changes.

-- Map and overtime settings are gone.
DELETE FROM settings WHERE key IN ('week_start', 'overtime_hours', 'map_lat', 'map_lng', 'map_zoom');
DROP TABLE IF EXISTS map_layers;

-- Properties, each with an aerial photo the owner uploads.
CREATE TABLE properties (
  id               INTEGER PRIMARY KEY AUTOINCREMENT,
  name             TEXT NOT NULL UNIQUE COLLATE NOCASE,
  notes            TEXT NOT NULL DEFAULT '',
  photo            BLOB,
  photo_type       TEXT,
  photo_width      INTEGER,
  photo_height     INTEGER,
  photo_updated_at TEXT,
  created_at       TEXT NOT NULL DEFAULT (strftime('%Y-%m-%dT%H:%M:%fZ', 'now'))
);

-- Tasks point at a property, optionally with a spot marked on its photo
-- (pin_x / pin_y are 0..1 fractions of the photo's width / height).
ALTER TABLE tasks ADD COLUMN property_id INTEGER REFERENCES properties(id) ON DELETE SET NULL;
ALTER TABLE tasks ADD COLUMN pin_x REAL;
ALTER TABLE tasks ADD COLUMN pin_y REAL;
ALTER TABLE tasks DROP COLUMN lat;
ALTER TABLE tasks DROP COLUMN lng;

-- Employees no longer enter time spent on a task.
ALTER TABLE completions DROP COLUMN minutes_spent;

-- No more GPS on the time clock.
ALTER TABLE time_entries DROP COLUMN in_lat;
ALTER TABLE time_entries DROP COLUMN in_lng;
ALTER TABLE time_entries DROP COLUMN out_lat;
ALTER TABLE time_entries DROP COLUMN out_lng;

-- auto_closed: the system clocked this person out after 14 hours.
-- needs_review: the employee still has to confirm or correct that clock-out.
-- edited: someone changed the times by hand (see time_edits).
ALTER TABLE time_entries ADD COLUMN auto_closed INTEGER NOT NULL DEFAULT 0;
ALTER TABLE time_entries ADD COLUMN needs_review INTEGER NOT NULL DEFAULT 0;
ALTER TABLE time_entries ADD COLUMN edited INTEGER NOT NULL DEFAULT 0;

-- Every manual change to the time clock, kept even if the punch is deleted.
CREATE TABLE time_edits (
  id            INTEGER PRIMARY KEY AUTOINCREMENT,
  entry_id      INTEGER NOT NULL,
  entry_user_id INTEGER NOT NULL REFERENCES users(id),
  editor_id     INTEGER REFERENCES users(id),     -- NULL = done automatically by the system
  kind          TEXT NOT NULL CHECK (kind IN ('add', 'edit', 'delete', 'auto_clockout', 'confirm')),
  work_date     TEXT NOT NULL,
  old_in        TEXT,
  old_out       TEXT,
  new_in        TEXT,
  new_out       TEXT,
  reason        TEXT NOT NULL DEFAULT '',
  created_at    TEXT NOT NULL DEFAULT (strftime('%Y-%m-%dT%H:%M:%fZ', 'now'))
);
CREATE INDEX idx_time_edits_date ON time_edits(work_date);
CREATE INDEX idx_time_edits_entry ON time_edits(entry_id);
