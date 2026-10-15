-- Starter guides. Edit them in the app to match your own equipment.

INSERT INTO guides (title, category, body) VALUES (
'Bush hog (rotary cutter) — hookup & operation',
'Equipment',
'Edit this guide to match YOUR tractor and cutter (model, PTO speed, grease points). Check the operator''s manual for anything that differs.

## Before you hook up
- Walk the field first: look for stumps, rocks, wire, T-posts, culverts and anything that could be thrown
- Check blades for cracks or big nicks and that blade bolts are tight
- Check gearbox oil level
- Make sure all shields, chains or bands are in place — never run with shields missing
- Grease the driveline U-joints and any grease points on the cutter

## Hook up (3-point)
1. Back the tractor straight and square to the cutter
2. Lower the 3-point arms and shut the tractor OFF before you get off
3. Attach the LEFT lower arm first, then the right (use the leveling crank on the right if needed)
4. Put in linch pins on both lower pins
5. Attach the top link and pin it
6. Adjust the top link so the deck sits level front-to-back (or the front slightly lower, per the manual)
7. Tighten the sway chains/stabilizers so the cutter cannot swing into the tires
! Engine OFF and key out before connecting the PTO shaft
8. Pull back the PTO collar, slide the shaft onto the tractor PTO stub, and release — pull back on the shaft to make sure it locked
9. Hook the driveline shield chain so the shield does not spin
10. Raise the cutter slowly all the way up and make sure the PTO shaft does not bottom out or bind

## Running it
1. Start the tractor, raise the cutter a few inches off the ground
2. At LOW idle, engage the PTO, then bring the engine up to rated PTO speed (usually 540 rpm — check the tractor''s tach mark)
3. Set cutting height (top link / tail wheel / chains). Keep blades off the dirt
4. Drive slow — about 2 to 5 mph. In very tall or thick brush, go slower or cut it twice (high pass, then low pass)
! Keep people and animals well away (manuals say 300 feet) — the cutter can throw rocks and debris
! Never let anyone ride on the tractor or cutter
- Lift the cutter going over terraces, ditches and crossing gravel roads
- Mow across steep slopes carefully, go slow, and avoid side slopes you are not comfortable on

## Shutting down & unhooking
1. Disengage the PTO and WAIT until the blades fully stop — they coast for a while
2. Lower the cutter to the ground, set the parking brake, engine off, key out
3. Disconnect the PTO shaft and lay it on its rest (not in the dirt)
4. Remove top link, then the right lower arm, then the left
5. Blow off grass and debris, check for wire wrapped around the spindle

## Notes
- Report any new noises, vibration, or damage in the task notes when you mark it complete'
);

INSERT INTO guides (title, category, body) VALUES (
'Daily water & feed check',
'Livestock',
'## Water
1. Check every tank is full and the float valve is working
2. Clean out algae, leaves or dead animals
3. Check for leaks around the tank and the line
- Winter: break ice and check heaters are working

## Feed & mineral
1. Check hay supply in each pasture — note if less than 3 days left
2. Check mineral feeders and refill if low
3. Look for spoiled or moldy hay

## Cattle
- Count head in each pasture against the expected number
- Look for anyone limping, off by themselves, bloated, not eating, or with eye problems
! Do not go into a pen alone with a fresh cow or a bull
- Write anything unusual in the task notes when you mark it complete'
);

INSERT INTO tasks (title, description, guide_id, priority, due_date, recur_type, recur_interval, recur_anchor, est_minutes)
SELECT 'Check water tanks, feed & cattle', 'Morning rounds — all pastures.', id, 'high',
       date('now'), 'daily', 1, date('now'), 60
FROM guides WHERE title = 'Daily water & feed check';
