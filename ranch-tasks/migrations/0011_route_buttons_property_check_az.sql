-- v10: route stops use need buttons; Property check stops in A–Z order.

-- Put Property check stops in alphabetical order. Only if the guide hasn't
-- been edited since it was added, so notes typed into it aren't lost (an
-- edited copy can be sorted with "Sort stops A–Z" in the guide editor).
UPDATE guides SET body = 'Check each property. Tap what it needs (that adds it to the to-do list right away) or All good.

## Austin''s
[ ] Hay -> Put out hay
[ ] Mineral -> Put out mineral
[ ] Liquid feed -> Put out liquid feed

## Behind the barn
[ ] Hay -> Put out hay
[ ] Mineral -> Put out mineral
[ ] Liquid feed -> Put out liquid feed

## Church Field
[ ] Hay -> Put out hay
[ ] Mineral -> Put out mineral
[ ] Liquid feed -> Put out liquid feed

## Dr. Berry''s
[ ] Hay -> Put out hay
[ ] Mineral -> Put out mineral
[ ] Liquid feed -> Put out liquid feed

## Horse Field
[ ] Hay -> Put out hay
[ ] Mineral -> Put out mineral
[ ] Liquid feed -> Put out liquid feed

## Kill cow field
[ ] Hay -> Put out hay
[ ] Mineral -> Put out mineral
[ ] Liquid feed -> Put out liquid feed

## Lake Field
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

## Sage hill well field
[ ] Hay -> Put out hay
[ ] Mineral -> Put out mineral
[ ] Liquid feed -> Put out liquid feed

## Sharpers
[ ] Hay -> Put out hay
[ ] Mineral -> Put out mineral
[ ] Liquid feed -> Put out liquid feed

## State Line
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

## Weaning Pen
[ ] Hay -> Put out hay
[ ] Mineral -> Put out mineral
[ ] Liquid feed -> Put out liquid feed

## Woodville Catfish Pond Field
[ ] Hay -> Put out hay
[ ] Mineral -> Put out mineral
[ ] Liquid feed -> Put out liquid feed

## Woodville middle field
[ ] Hay -> Put out hay
[ ] Mineral -> Put out mineral
[ ] Liquid feed -> Put out liquid feed
'
  WHERE title = 'Property check' AND body = 'Check each property and tick what it needs. When you mark this complete, the needs are added to the grouped to-dos (one per supply), the same as the feed routes.

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
[ ] Liquid feed -> Put out liquid feed';

-- Feed-route intros describe the new buttons (stop names and needs unchanged).
UPDATE guides SET body = replace(body, 'Tick each stop as you reach it, and tick what it needs.', 'Tap what each stop needs (that adds it to the to-do list right away), or All good if it needs nothing.')
  WHERE title IN ('M-W-F feed route', 'T-TH feed route');

-- Route task descriptions match the buttons.
UPDATE tasks SET description = replace(replace(description, 'tick what each stop needs', 'tap what each stop needs'),
    'tick what each one needs', 'tap what each one needs')
  WHERE title IN ('M-W-F feed route', 'T-TH feed route', 'Property check');
