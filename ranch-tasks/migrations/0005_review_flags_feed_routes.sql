-- v4: owner review flags on time changes, and the feed-route guides + tasks.

-- Time changes made by hands or by the system (auto clock-out) are flagged
-- for the owner; reviewed_at/reviewed_by record when the owner cleared it.
ALTER TABLE time_edits ADD COLUMN needs_review INTEGER NOT NULL DEFAULT 0;
ALTER TABLE time_edits ADD COLUMN reviewed_at TEXT;
ALTER TABLE time_edits ADD COLUMN reviewed_by INTEGER REFERENCES users(id);
UPDATE time_edits SET needs_review = 1
  WHERE editor_id IS NULL OR editor_id IN (SELECT id FROM users WHERE role <> 'owner');

-- Feed routes. Lines like "[ ] Needs hay -> Put out hay" are follow-ups: if
-- ticked when the route is completed, they become to-dos for the next day.
INSERT INTO guides (title, category, body) VALUES ('M-W-F feed route', 'Feeding', 'Tick what each stop needs as you go. When you mark the route complete, every ticked item becomes a high-priority to-do for tomorrow, open to anyone (for example "Put out hay – Sharpers").

## Behind the barn
[ ] Needs hay -> Put out hay
[ ] Needs mineral -> Put out mineral
[ ] Needs liquid feed -> Put out liquid feed

## Horse field
[ ] Needs hay -> Put out hay

## Lake field
[ ] Needs hay -> Put out hay
[ ] Needs mineral -> Put out mineral
[ ] Needs liquid feed -> Put out liquid feed

## Church field
[ ] Needs hay -> Put out hay
[ ] Needs mineral -> Put out mineral
[ ] Needs liquid feed -> Put out liquid feed

## Austin''s
[ ] Needs hay -> Put out hay
[ ] Needs mineral -> Put out mineral
[ ] Needs liquid feed -> Put out liquid feed

## Sharpers
[ ] Needs hay -> Put out hay
[ ] Needs mineral -> Put out mineral
[ ] Needs liquid feed -> Put out liquid feed

## Dr. Berrys
[ ] Needs hay -> Put out hay
[ ] Needs mineral -> Put out mineral

## Woodville
[ ] Needs hay -> Put out hay
[ ] Needs mineral -> Put out mineral
[ ] Needs liquid feed -> Put out liquid feed

## State line
[ ] Needs hay -> Put out hay
[ ] Needs mineral -> Put out mineral
[ ] Needs liquid feed -> Put out liquid feed

## Kill cows
[ ] Needs hay -> Put out hay
[ ] Needs mineral -> Put out mineral
[ ] Needs liquid feed -> Put out liquid feed

## Sterling (house)
[ ] Needs hay -> Put out hay
[ ] Needs mineral -> Put out mineral
[ ] Needs liquid feed -> Put out liquid feed

## Sterling (Bulls)
[ ] Needs hay -> Put out hay
[ ] Needs mineral -> Put out mineral
[ ] Needs liquid feed -> Put out liquid feed');
INSERT INTO guides (title, category, body) VALUES ('T-TH feed route', 'Feeding', 'Tick what each stop needs as you go. When you mark the route complete, every ticked item becomes a high-priority to-do for tomorrow, open to anyone (for example "Put out hay – Sharpers").

## Weaning pen feeder
[ ] Needs feed -> Put out feed

## Church field
- Checked

## Sterling (Bulls)
- Checked

## Sage hill (Heifers)
[ ] Needs hay -> Put out hay
[ ] Needs mineral -> Put out mineral
[ ] Needs liquid feed -> Put out liquid feed

## Sage hill (Commercial cows)
[ ] Needs hay -> Put out hay
[ ] Needs mineral -> Put out mineral
[ ] Needs liquid feed -> Put out liquid feed');

-- Recurring route tasks, open to anyone, starting on the next route day
-- (ranch time is approximated as UTC-6 for the first due date only).
INSERT INTO tasks (title, description, guide_id, priority, due_date, recur_type, recur_interval, recur_weekdays, recur_anchor)
SELECT 'M-W-F feed route', 'Drive the Monday / Wednesday / Friday feed route and tick what each stop needs.', id, 'high',
       date('now', '-6 hours', '+' || (CASE strftime('%w', 'now', '-6 hours') WHEN '0' THEN 1 WHEN '2' THEN 1 WHEN '4' THEN 1 WHEN '6' THEN 2 ELSE 0 END) || ' days'), 'weekly', 1, '1,3,5',
       date('now', '-6 hours', '+' || (CASE strftime('%w', 'now', '-6 hours') WHEN '0' THEN 1 WHEN '2' THEN 1 WHEN '4' THEN 1 WHEN '6' THEN 2 ELSE 0 END) || ' days')
FROM guides WHERE title = 'M-W-F feed route';

INSERT INTO tasks (title, description, guide_id, priority, due_date, recur_type, recur_interval, recur_weekdays, recur_anchor)
SELECT 'T-TH feed route', 'Drive the Tuesday / Thursday feed route and tick what each stop needs.', id, 'high',
       date('now', '-6 hours', '+' || (CASE strftime('%w', 'now', '-6 hours') WHEN '0' THEN 2 WHEN '1' THEN 1 WHEN '3' THEN 1 WHEN '5' THEN 4 WHEN '6' THEN 3 ELSE 0 END) || ' days'), 'weekly', 1, '2,4',
       date('now', '-6 hours', '+' || (CASE strftime('%w', 'now', '-6 hours') WHEN '0' THEN 2 WHEN '1' THEN 1 WHEN '3' THEN 1 WHEN '5' THEN 4 WHEN '6' THEN 3 ELSE 0 END) || ' days')
FROM guides WHERE title = 'T-TH feed route';
