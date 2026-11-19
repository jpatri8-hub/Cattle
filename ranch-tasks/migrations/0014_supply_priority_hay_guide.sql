-- v13: supply priorities, Feeding Hay guide on hay to-dos, one liquid feed to-do.

-- T-TH liquid feed buttons said "Put out liquid", which started a separate
-- to-do from "Put out liquid feed". Point them at the same one.
UPDATE guides SET body = substr(replace(replace((replace(replace((char(10) || body || char(10)), char(10) || '[ ] Liquid feed -> Put out liquid' || char(10), char(10) || '[ ] Liquid feed -> Put out liquid feed' || char(10)), char(10) || '[ ] Liquid feed -> Put out liquid ' || char(10), char(10) || '[ ] Liquid feed -> Put out liquid feed' || char(10))), char(10) || '[ ] Liquid feed -> Put out liquid' || char(10), char(10) || '[ ] Liquid feed -> Put out liquid feed' || char(10)), char(10) || '[ ] Liquid feed -> Put out liquid ' || char(10), char(10) || '[ ] Liquid feed -> Put out liquid feed' || char(10)), 2, length(replace(replace((replace(replace((char(10) || body || char(10)), char(10) || '[ ] Liquid feed -> Put out liquid' || char(10), char(10) || '[ ] Liquid feed -> Put out liquid feed' || char(10)), char(10) || '[ ] Liquid feed -> Put out liquid ' || char(10), char(10) || '[ ] Liquid feed -> Put out liquid feed' || char(10))), char(10) || '[ ] Liquid feed -> Put out liquid' || char(10), char(10) || '[ ] Liquid feed -> Put out liquid feed' || char(10)), char(10) || '[ ] Liquid feed -> Put out liquid ' || char(10), char(10) || '[ ] Liquid feed -> Put out liquid feed' || char(10))) - 2)
  WHERE title = 'T-TH feed route';

-- Open supply to-dos: mineral and liquid feed are low priority, hay stays high.
UPDATE tasks SET priority = 'low'
  WHERE status = 'open' AND followup_key IS NOT NULL
    AND (followup_key LIKE '%mineral%' OR followup_key LIKE '%liquid%');

-- Open hay to-dos get the Feeding Hay guide.
UPDATE tasks SET guide_id = (SELECT id FROM guides WHERE title = 'Feeding Hay' COLLATE NOCASE AND archived = 0)
  WHERE status = 'open' AND followup_key LIKE '%hay%' AND guide_id IS NULL;
