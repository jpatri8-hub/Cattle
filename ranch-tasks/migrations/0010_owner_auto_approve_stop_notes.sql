-- v9: the owner's own completions are approved automatically, and stop names
-- no longer use parentheses (text in parentheses after a stop is now a note
-- that isn't copied to to-dos).

UPDATE completions SET review_status = 'approved', reviewed_by = user_id, reviewed_at = completed_at
  WHERE review_status = 'pending' AND user_id IN (SELECT id FROM users WHERE role = 'owner');

UPDATE guides SET body = replace(replace(replace(replace(body, 'Sterling (Bulls)', 'Sterling bulls'), 'Sterling (house)', 'Sterling house'), 'Sage hill (Heifers)', 'Sage hill heifers'), 'Sage hill (Commercial cows)', 'Sage hill commercial cows')
  WHERE title IN ('M-W-F feed route', 'T-TH feed route');

UPDATE tasks SET
    title = replace(replace(replace(replace(title, 'Sterling (Bulls)', 'Sterling bulls'), 'Sterling (house)', 'Sterling house'), 'Sage hill (Heifers)', 'Sage hill heifers'), 'Sage hill (Commercial cows)', 'Sage hill commercial cows'),
    description = replace(replace(replace(replace(description, 'Sterling (Bulls)', 'Sterling bulls'), 'Sterling (house)', 'Sterling house'), 'Sage hill (Heifers)', 'Sage hill heifers'), 'Sage hill (Commercial cows)', 'Sage hill commercial cows'),
    followup_stops = replace(replace(replace(replace(followup_stops, 'Sterling (Bulls)', 'Sterling bulls'), 'Sterling (house)', 'Sterling house'), 'Sage hill (Heifers)', 'Sage hill heifers'), 'Sage hill (Commercial cows)', 'Sage hill commercial cows'),
    followup_done = replace(replace(replace(replace(followup_done, 'Sterling (Bulls)', 'Sterling bulls'), 'Sterling (house)', 'Sterling house'), 'Sage hill (Heifers)', 'Sage hill heifers'), 'Sage hill (Commercial cows)', 'Sage hill commercial cows')
  WHERE followup_key IS NOT NULL;
