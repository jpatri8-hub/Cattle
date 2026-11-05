-- v6: progress tick-boxes for each stop on a grouped follow-up to-do.
-- followup_done is a JSON list of the stops (from followup_stops) already done.
ALTER TABLE tasks ADD COLUMN followup_done TEXT;

-- Shorter feed routes: needs show side by side under each stop as
-- "Hay  Mineral  Liquid feed", and a one-line intro.
UPDATE guides SET body = replace(replace(replace(replace(replace(body,
    '[ ] Needs hay ->', '[ ] Hay ->'),
    '[ ] Needs mineral ->', '[ ] Mineral ->'),
    '[ ] Needs liquid feed ->', '[ ] Liquid feed ->'),
    '[ ] Needs feed ->', '[ ] Feed ->'),
    'Tick off each stop as you get to it, and tick what it needs. When you mark the route complete, the needs are grouped into one high-priority to-do per supply, open to anyone with no due date (for example "Put out hay: Sharpers, Lake field"). If that to-do is still open, new stops are added to it.',
    'Tick each stop as you reach it, and tick what it needs.')
  WHERE title IN ('M-W-F feed route', 'T-TH feed route');
