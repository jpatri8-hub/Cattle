# Cattle Manager

Flask + SQLAlchemy app for Patrick's Cattle Ranch, deployed on Render
(web service "Patrick's Cattle Ranch", `srv-d9qcl4v10e5c739dqshg`).

## Database

Production data lives in **Neon** (project `super-base-22575942`,
database `cattle_manager`, Postgres 18, region `aws-us-west-2`), not in
Render's managed Postgres. `DATABASE_URL` on the Render service points at
Neon; `render.yaml` has no `databases:` block and marks `DATABASE_URL` as
`sync: false` (externally managed, never committed to git).

The old Render Postgres instance (`dpg-d9phdp6417fc73du4eng-a`,
"cattle-manager-db") is being kept around untouched as a retention copy
after the Neon migration (migrated 2026-11-14) and is safe to delete once
the user confirms, but no tool can delete it — that's a manual action in
the Render dashboard.

`config.py::_normalize_db_url()` already forces `postgresql+psycopg2://`
on any `postgres://`/`postgresql://` URL, so no code changes are needed
for Neon vs. Render.

## Direct database writes via Neon MCP tools

If asked to write data directly (bypassing the Flask app's UI/forms), use
this standing practice rather than writing straight to production with no
safety net:

1. Before writing, call `create_snapshot` on the production branch with
   `expires_at` ~12 hours out. This is a point-in-time backup, not a
   running branch — cheap, and it auto-deletes itself.
2. Write directly to the production/default branch (no need for a
   separate branch for the write itself).
3. Tell the user what you wrote. If they report something's wrong within
   that window, restore with `restore_snapshot` (`target_branch_id` = the
   production branch) — but **never run this autonomously; always confirm
   with the user first**, since it's destructive and rolls back *all*
   production data to that point, not just your own write (a real risk if
   anyone else has used the live app in between).

This tradeoff (no verification step before writing, but a time-boxed
rollback window) was chosen deliberately over a create-branch →
verify-diff → replay-to-prod workflow, since this is a low-traffic,
two-user app where the extra round-trip wasn't worth it. Revisit if that
changes.
