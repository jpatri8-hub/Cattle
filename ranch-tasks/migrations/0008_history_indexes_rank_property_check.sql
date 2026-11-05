-- v7: indexes for long-term history, Anytime ranking, repeat-when-done tasks,
-- and the owner's Property check.

-- Indexes for queries that run on every page load, so they stay fast as
-- years of punches, changes and completed tasks pile up.
CREATE INDEX IF NOT EXISTS idx_time_open ON time_entries(clock_in) WHERE clock_out IS NULL;
CREATE INDEX IF NOT EXISTS idx_time_needs_fix ON time_entries(user_id) WHERE needs_review = 1;
CREATE INDEX IF NOT EXISTS idx_time_edits_review ON time_edits(needs_review, reviewed_at);
CREATE INDEX IF NOT EXISTS idx_tasks_status_updated ON tasks(status, updated_at);
CREATE INDEX IF NOT EXISTS idx_tasks_followup ON tasks(status, followup_key);
CREATE INDEX IF NOT EXISTS idx_sessions_expires ON sessions(expires_at);

-- rank: owner-set order (1, 2, 3...) for tasks with no due date.
ALTER TABLE tasks ADD COLUMN rank INTEGER;
-- repeat_on_complete: stays on the list (due anytime) after each completion.
ALTER TABLE tasks ADD COLUMN repeat_on_complete INTEGER NOT NULL DEFAULT 0;

INSERT INTO guides (title, category, body) VALUES ('Property check', 'Feeding', 'Check each property and tick what it needs. When you mark this complete, the needs are added to the grouped to-dos (one per supply), the same as the feed routes.

## Sharpers
[ ] Hay -> Put out hay
[ ] Mineral -> Put out mineral
[ ] Liquid feed -> Put out liquid feed

## Austin''s
[ ] Hay -> Put out hay
[ ] Mineral -> Put out mineral
[ ] Liquid feed -> Put out liquid feed

## Lake Field
[ ] Hay -> Put out hay
[ ] Mineral -> Put out mineral
[ ] Liquid feed -> Put out liquid feed

## Church Field
[ ] Hay -> Put out hay
[ ] Mineral -> Put out mineral
[ ] Liquid feed -> Put out liquid feed

## Horse Field
[ ] Hay -> Put out hay
[ ] Mineral -> Put out mineral
[ ] Liquid feed -> Put out liquid feed

## Behind the barn
[ ] Hay -> Put out hay
[ ] Mineral -> Put out mineral
[ ] Liquid feed -> Put out liquid feed

## Weaning Pen
[ ] Hay -> Put out hay
[ ] Mineral -> Put out mineral
[ ] Liquid feed -> Put out liquid feed

## Sage hill well field
[ ] Hay -> Put out hay
[ ] Mineral -> Put out mineral
[ ] Liquid feed -> Put out liquid feed

## Sage hill front field
[ ] Hay -> Put out hay
[ ] Mineral -> Put out mineral
[ ] Liquid feed -> Put out liquid feed

## Sage hill grass trap
[ ] Hay -> Put out hay
[ ] Mineral -> Put out mineral
[ ] Liquid feed -> Put out liquid feed

## Sage hill past blown down barn
[ ] Hay -> Put out hay
[ ] Mineral -> Put out mineral
[ ] Liquid feed -> Put out liquid feed

## Sage hill past iron gates
[ ] Hay -> Put out hay
[ ] Mineral -> Put out mineral
[ ] Liquid feed -> Put out liquid feed

## Kill cow field
[ ] Hay -> Put out hay
[ ] Mineral -> Put out mineral
[ ] Liquid feed -> Put out liquid feed

## Sterling East
[ ] Hay -> Put out hay
[ ] Mineral -> Put out mineral
[ ] Liquid feed -> Put out liquid feed

## Sterling House Field
[ ] Hay -> Put out hay
[ ] Mineral -> Put out mineral
[ ] Liquid feed -> Put out liquid feed

## Dr. Berry''s
[ ] Hay -> Put out hay
[ ] Mineral -> Put out mineral
[ ] Liquid feed -> Put out liquid feed

## State Line
[ ] Hay -> Put out hay
[ ] Mineral -> Put out mineral
[ ] Liquid feed -> Put out liquid feed

## Woodville middle field
[ ] Hay -> Put out hay
[ ] Mineral -> Put out mineral
[ ] Liquid feed -> Put out liquid feed

## Woodville Catfish Pond Field
[ ] Hay -> Put out hay
[ ] Mineral -> Put out mineral
[ ] Liquid feed -> Put out liquid feed');

INSERT INTO tasks (title, description, guide_id, assigned_to, priority, due_date, repeat_on_complete)
SELECT 'Property check', 'Check every property and tick what each one needs.', g.id,
       (SELECT id FROM users WHERE role = 'owner' AND active = 1 ORDER BY id LIMIT 1), 'normal', NULL, 1
FROM guides g WHERE g.title = 'Property check';
