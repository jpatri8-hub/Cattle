-- v5: archive guides, grouped follow-up to-dos, tick-boxes for each route stop.

ALTER TABLE guides ADD COLUMN archived INTEGER NOT NULL DEFAULT 0;

-- Follow-up to-dos are grouped by supply ("Put out hay: Sharpers, Lake field").
-- followup_key is the supply's action; followup_stops is a JSON list of stops.
ALTER TABLE tasks ADD COLUMN followup_key TEXT;
ALTER TABLE tasks ADD COLUMN followup_stops TEXT;

-- Feed routes: every stop heading gets its own tick-box ("## [ ] Sharpers"),
-- which replaces the separate "Checked" steps, and the intro explains grouping.
UPDATE guides SET body = replace(replace(replace(body,
    char(10) || '## ', char(10) || '## [ ] '),
    char(10) || '- Checked', ''),
    'Tick what each stop needs as you go. When you mark the route complete, every ticked item becomes a high-priority to-do for tomorrow, open to anyone (for example "Put out hay – Sharpers").',
    'Tick off each stop as you get to it, and tick what it needs. When you mark the route complete, the needs are grouped into one high-priority to-do per supply, open to anyone with no due date (for example "Put out hay: Sharpers, Lake field"). If that to-do is still open, new stops are added to it.')
  WHERE title IN ('M-W-F feed route', 'T-TH feed route');
