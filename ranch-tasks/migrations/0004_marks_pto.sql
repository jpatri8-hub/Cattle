-- v3: several spots and/or lines on a property photo per task, and PTO entries.

-- marks: JSON list of [{"type":"pin","x":..,"y":..} | {"type":"line","points":[[x,y],...]}],
-- coordinates are 0..1 fractions of the photo's width and height.
ALTER TABLE tasks ADD COLUMN marks TEXT;
UPDATE tasks SET marks = json_array(json_object('type', 'pin', 'x', pin_x, 'y', pin_y))
  WHERE pin_x IS NOT NULL AND pin_y IS NOT NULL;
ALTER TABLE tasks DROP COLUMN pin_x;
ALTER TABLE tasks DROP COLUMN pin_y;

-- kind = 'pto': paid time off the owner adds as a date and number of hours.
-- Stored with clock_in/clock_out spanning that many hours so totals just work.
ALTER TABLE time_entries ADD COLUMN kind TEXT NOT NULL DEFAULT 'work' CHECK (kind IN ('work', 'pto'));
ALTER TABLE time_edits ADD COLUMN entry_kind TEXT NOT NULL DEFAULT 'work';
