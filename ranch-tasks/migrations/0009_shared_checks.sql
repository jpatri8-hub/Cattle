-- v8: guide tick-boxes are shared on the task while it's open, and a copy of
-- what was ticked is kept with each completion for the owner to review.
-- guide_checks: {"steps": [step numbers], "followups": [indexes]}
ALTER TABLE tasks ADD COLUMN guide_checks TEXT;
-- checklist: {"steps": [[label, ticked, isStop]], "stops": [[stop, done]], "needs": [to-do titles]}
ALTER TABLE completions ADD COLUMN checklist TEXT;
