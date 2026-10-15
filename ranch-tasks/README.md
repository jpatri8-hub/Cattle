# Ranch Tasks

A phone-friendly task list, how-to guide library, time clock and payroll
export for the ranch. It runs on **Cloudflare's free plan** (Workers + D1
database), so hosting costs nothing.

## What it does

| Need | How it works |
|---|---|
| **Task list** | Tasks are grouped as Overdue, Today, Next 7 days, Anytime and Later. Tap ✓ to mark one done. Filter by "Mine + unassigned" or "Everyone". |
| **Recurring tasks** | Repeat every day, weekdays, weekly, every 2 weeks, monthly, quarterly, **twice a year**, yearly, or a custom rule like "every 3 days" or "Mon/Wed/Fri". When someone completes a recurring task it moves to the next due date by itself, and missed days don't stack up. One-time tasks close when they're done. |
| **Reusable instructions** | **Guides** hold how-to notes, such as how to hook up and run the bush hog, written once and attached to any number of tasks. When a hand opens the task, the guide's steps show as tick-boxes. Lines that start with `!` show as yellow safety callouts. A bush hog guide and a daily water/feed guide are included to start from. |
| **Roles** | **Owner** and **Hand**, and you can have several of each. Everyone can create tasks, write guides and mark work complete. Hands can only edit tasks they created. Owners can edit anything, review completed work, manage people, see everyone's hours, and run payroll. |
| **Owner review** | Each completion lands in **More → Review** with who did it, when, how long it took, whether it was late, and the hand's notes. You can **Approve** it, or **Flag** it with a note, which also puts a one-time task back on the list. "Approve all" clears the queue. |
| **Time clock** | Big Clock in / Clock out button, with optional GPS stamp. Owners can add a missed punch or fix a wrong one, and every change is marked "edited by". |
| **Payroll report** | **Time** tab → pick a period → **⬇ CSV** gives every punch plus each person's regular and overtime hours (weekly OT threshold and pay-week start are set in Settings). It can also be emailed automatically every Monday. See below. |
| **Productivity** | **More → Team** shows each person's hours, tasks done, tasks/day, task time as a share of hours on the clock, on-time %, and flagged work. Hands only see their own numbers. |
| **Map** | Satellite, topo and street maps. Each task can have a pin (tap the map, use your GPS, or tap an imported onX waypoint), and the pin color shows whether it's overdue, due today or upcoming. "Directions" opens Google Maps. |
| **onX layers** | onX doesn't let other apps embed its maps, so export your markups instead. In onX, select waypoints, lines or areas → **Export** → **KML** or **GPX**, then on the Map tab tap **Import onX file**. Property lines, pastures, gates and water tanks all show up as overlays. |

On iPhone, open the site in Safari → Share → **Add to Home Screen** and it works like an app.

## Is it free on Cloudflare?

Yes. Everything here fits in the Workers **Free** plan:

- Workers: 100,000 requests/day (a busy ranch day is a few hundred)
- D1 database: 5 GB storage, 5 million row reads/day
- Cron trigger for the weekly payroll email: included
- Your site address will be `https://ranch-task.<your-name>.workers.dev`

The only optional cost is a domain name (~$10/yr), and you need one **only** if
you want the app to send the payroll email itself (Cloudflare can only send
email from a domain you own). Without it, download the CSV and send it yourself.

## Deploy (about 10 minutes, one time)

You need [Node.js](https://nodejs.org) 20+ and a free
[Cloudflare account](https://dash.cloudflare.com/sign-up).

```bash
cd ranch-tasks
npm install
npx wrangler login                    # opens a browser to sign in to Cloudflare
npx wrangler d1 create ranch-tasks    # prints a database_id
```

Paste the printed `database_id` into `wrangler.toml` (replace
`REPLACE_WITH_YOUR_DATABASE_ID`), then:

```bash
npm run db:remote    # creates the tables + starter guides
npm run deploy       # prints your https://ranch-task.<name>.workers.dev URL
```

Open the URL. The first screen creates the **owner** account. Then go to
**More → Team → + Add person** to give each hand a username and a PIN.

To ship updates later: `npm run deploy` (plus `npm run db:remote` if a new file
appears in `migrations/`).

> **Auto-deploy from GitHub (optional):** in the Cloudflare dashboard go to
> Workers & Pages → Create → Import a repository, pick this repo, and set the
> root directory to `ranch-tasks`. Every push to `main` then redeploys.

## Payroll / ShiftFlow

The CSV has one row per punch (`Employee, Date, Clock In, Clock Out, Hours,
Note`) followed by a per-employee summary (`Regular, Overtime, Total`).

- **If your payroll provider takes a file upload or import**, upload the CSV
  (you may need to match column names once on their side).
- **If they just want the hours sent to them**, use the email option below,
  or download the CSV and forward it.

### Emailing payroll (optional)

1. Put a domain on Cloudflare and turn on **Email → Email Routing**.
2. Under Email Routing → Destination addresses, add and **verify** the payroll
   address.
3. In `wrangler.toml`, uncomment the `[[send_email]]` block and set
   `PAYROLL_FROM` to an address on your domain (e.g. `timeclock@yourranch.com`).
   `npm run deploy`.
4. In the app: **More → Settings**, enter the payroll email and tick
   **Auto-email last week's payroll every Monday**. An **✉ Email to payroll**
   button also appears on the Time tab for sending any period by hand.

The weekly email runs Monday 13:00 UTC (about 8 am Central). Change `crons` in
`wrangler.toml` for a different time.

## Writing guides

```
## Hook up
1. Back up square to the cutter
2. Attach the LEFT lower arm first
! Engine OFF and key out before connecting the PTO
- Grease U-joints
```

`## Heading`, `1. step`, `- bullet`, `**bold**`, `! safety warning`,
`[link](https://...)`. Guides attached to a task show their steps as
tick-boxes, so a hand can check them off in the field.

## Local development

```bash
npm install
npm run db:local     # local SQLite copy of the database
npm run dev          # http://localhost:8787
npm test             # recurrence, payroll and guide-rendering tests
```

## How it's built

```
ranch-tasks/
  wrangler.toml          Cloudflare config (D1 binding, cron, optional email)
  migrations/            database schema + starter guides
  src/worker.js          JSON API: auth, tasks, guides, review, time clock, payroll, stats, map layers
  src/auth.js            PBKDF2 password hashing, session cookies
  src/payroll.js         hours, weekly overtime, CSV (pure functions, tested)
  src/email.js           builds the payroll email with the CSV attached
  public/                the app (plain HTML/CSS/JS, no build step)
    app.js               screens and routing
    recurrence.js        repeat rules, shared by the browser and the server
    md.js                safe guide formatter
    geo.js               onX KML/GPX → map layer converter
  test/                  node --test unit tests
```

- Logins use a username plus a password or PIN, with 30-day sessions in an
  HttpOnly cookie. An account locks for 15 minutes after 8 wrong tries.
- All dates use the ranch time zone (Settings), so "today" and payroll days
  are right no matter where the server runs.
- Archiving a task keeps its history, so productivity numbers stay accurate.
