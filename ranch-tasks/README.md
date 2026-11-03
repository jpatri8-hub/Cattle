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
| **Owner review** | Each completion lands in **More → Review** with who did it, when, whether it was late, and the hand's notes. You can **Approve** it, or **Flag** it with a note, which also puts a one-time task back on the list. "Approve all" clears the queue. |
| **Time clock** | Big Clock in / Clock out button. Anyone still on the clock after **14 hours** is clocked out automatically, and the next time they open the app it asks them for their real clock-out time. Employees can fix their own punches or add a missed one, but they have to give a reason. |
| **Change log** | Every manual change, whether a missed punch, a changed time, a deleted punch, or an automatic 14-hour clock-out, is kept with the before and after times, who made it, and why. Owners see it at the bottom of the **Time** tab, and any changed punch is tagged with a **History** link. Changed punches are also marked in the payroll CSV. |
| **Payroll report** | Pay periods run the **1st–15th** and the **16th–end of the month**. **Time** tab → pick a pay period → **⬇ CSV** gives every punch, its hours, and any changes, plus each person's total. It can also be emailed automatically on the 1st and 16th. See below. |
| **Productivity** | **More → Team** shows each person's hours, tasks done, tasks/day, on-time %, flagged work, and how many of their punches were changed or auto clocked out. Hands only see their own numbers. |
| **Property photos** | Under **Properties**, the owner adds each property and uploads an aerial photo. Large photos are shrunk on the phone before uploading. When a task is given a property, its photo shows on the task, and you can tap the photo to mark the exact spot. Each property's page shows its photo with numbered, color-coded pins for its open tasks (red overdue, orange today, green upcoming, blue anytime). |

On iPhone, open the site in Safari → Share → **Add to Home Screen** and it works like an app.

## Is it free on Cloudflare?

Yes. Everything here fits in the Workers **Free** plan:

- Workers: 100,000 requests/day (a busy ranch day is a few hundred)
- D1 database: 5 GB storage, 5 million row reads/day
- Hourly cron trigger (auto clock-out and the payroll email): included
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
appears in `migrations/`). If you deploy from GitHub with the deploy command
`npx wrangler d1 migrations apply ranch-tasks --remote && npx wrangler deploy`,
database updates are applied automatically on every deploy.

> **Auto-deploy from GitHub (optional):** in the Cloudflare dashboard go to
> Workers & Pages → Create → Import a repository, pick this repo, and set the
> root directory to `ranch-tasks`. Every push to `main` then redeploys.

## Payroll / ShiftFlow

The CSV has one row per punch (`Employee, Date, Clock In, Clock Out, Hours,
Changes, Note`) followed by a per-employee summary (`Total Hours`, punches
changed by hand, auto clock-outs).

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
   **Email the pay period that just ended on the 1st and 16th**. An
   **✉ Email to payroll** button also appears on the Time tab for sending any
   period by hand.

The email goes out at 8 am ranch time (the time zone in Settings) on the 1st
(for the 16th–end of last month) and the 16th (for the 1st–15th).

## Passwords

Passwords and PINs are stored scrambled (PBKDF2 hashes), so nobody, including
the owner, can look them up. That protects your hands if they reuse a password
somewhere else. If someone forgets theirs, the owner sets a new one under
**More → Team → Edit**.

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
  src/worker.js          JSON API: auth, tasks, guides, review, time clock + change log, payroll, stats, properties/photos
  src/auth.js            PBKDF2 password hashing, session cookies
  src/payroll.js         hours, change markers, CSV (pure functions, tested)
  src/email.js           builds the payroll email with the CSV attached
  public/                the app (plain HTML/CSS/JS, no build step)
    app.js               screens and routing
    recurrence.js        repeat rules, shared by the browser and the server
    md.js                safe guide formatter
    payperiod.js         1st–15th / 16th–end pay periods, shared with the server
  test/                  node --test unit tests
```

- Logins use a username plus a password or PIN, with 30-day sessions in an
  HttpOnly cookie. An account locks for 15 minutes after 8 wrong tries.
- All dates use the ranch time zone (Settings), so "today" and payroll days
  are right no matter where the server runs.
- Archiving a task keeps its history, so productivity numbers stay accurate.
