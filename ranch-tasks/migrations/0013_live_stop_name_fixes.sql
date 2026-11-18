-- v12: match stop names across the feed routes and Property check, read from
-- the live guides: Behind the Barn, Woodville Middle Field, Sterling East
-- (yearling bulls), Weaning Pen, Kill Cow Field, Sage Hill Well Field. Whole
-- heading lines are matched exactly, so nothing else in the guides changes.

UPDATE guides SET body = substr(replace(replace(replace((char(10) || body || char(10)), char(10) || '## [ ] Behind the barn ' || char(10), char(10) || '## [ ] Behind the Barn' || char(10)), char(10) || '## [ ] Woodville middle field ' || char(10), char(10) || '## [ ] Woodville Middle Field' || char(10)), char(10) || '## [ ] Sterling east (yearling bulls)' || char(10), char(10) || '## [ ] Sterling East (yearling bulls)' || char(10)), 2, length(replace(replace(replace((char(10) || body || char(10)), char(10) || '## [ ] Behind the barn ' || char(10), char(10) || '## [ ] Behind the Barn' || char(10)), char(10) || '## [ ] Woodville middle field ' || char(10), char(10) || '## [ ] Woodville Middle Field' || char(10)), char(10) || '## [ ] Sterling east (yearling bulls)' || char(10), char(10) || '## [ ] Sterling East (yearling bulls)' || char(10))) - 2)
  WHERE title = 'M-W-F feed route';

UPDATE guides SET body = substr(replace(replace(replace(replace((char(10) || body || char(10)), char(10) || '## [ ] Weaning pen' || char(10), char(10) || '## [ ] Weaning Pen' || char(10)), char(10) || '## [ ] Sterling east (yearling bulls)' || char(10), char(10) || '## [ ] Sterling East (yearling bulls)' || char(10)), char(10) || '## [ ] Kill Cows ' || char(10), char(10) || '## [ ] Kill Cow Field' || char(10)), char(10) || '## [ ] Sage hill well field ' || char(10), char(10) || '## [ ] Sage Hill Well Field' || char(10)), 2, length(replace(replace(replace(replace((char(10) || body || char(10)), char(10) || '## [ ] Weaning pen' || char(10), char(10) || '## [ ] Weaning Pen' || char(10)), char(10) || '## [ ] Sterling east (yearling bulls)' || char(10), char(10) || '## [ ] Sterling East (yearling bulls)' || char(10)), char(10) || '## [ ] Kill Cows ' || char(10), char(10) || '## [ ] Kill Cow Field' || char(10)), char(10) || '## [ ] Sage hill well field ' || char(10), char(10) || '## [ ] Sage Hill Well Field' || char(10))) - 2)
  WHERE title = 'T-TH feed route';

UPDATE guides SET body = substr(replace((char(10) || body || char(10)), char(10) || '## Sterling (Bulls)' || char(10), char(10) || '## Sterling East (yearling bulls)' || char(10)), 2, length(replace((char(10) || body || char(10)), char(10) || '## Sterling (Bulls)' || char(10), char(10) || '## Sterling East (yearling bulls)' || char(10))) - 2)
  WHERE title = 'Property check';

-- Open to-dos that still carry an old spelling get the new one.

UPDATE tasks SET followup_stops = replace(replace(replace(replace(replace(replace(replace(followup_stops, '"Behind the barn"', '"Behind the Barn"'), '"Woodville middle field"', '"Woodville Middle Field"'), '"Sterling east"', '"Sterling East"'), '"Weaning pen"', '"Weaning Pen"'), '"Kill Cows"', '"Kill Cow Field"'), '"Sage hill well field"', '"Sage Hill Well Field"'), '"Sterling"', '"Sterling East"')
  WHERE followup_key IS NOT NULL AND status = 'open' AND followup_stops IS NOT NULL;

UPDATE tasks SET followup_done = replace(replace(replace(replace(replace(replace(replace(followup_done, '"Behind the barn"', '"Behind the Barn"'), '"Woodville middle field"', '"Woodville Middle Field"'), '"Sterling east"', '"Sterling East"'), '"Weaning pen"', '"Weaning Pen"'), '"Kill Cows"', '"Kill Cow Field"'), '"Sage hill well field"', '"Sage Hill Well Field"'), '"Sterling"', '"Sterling East"')
  WHERE followup_key IS NOT NULL AND status = 'open' AND followup_done IS NOT NULL;
