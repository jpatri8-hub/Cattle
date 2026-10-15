// Ranch Tasks — Cloudflare Worker API. Static UI is served from /public.
import { EmailMessage } from 'cloudflare:email';
import { hashPassword, verifyPassword, randomHex, getCookie, sessionCookie } from './auth.js';
import { nextDueAfterCompletion, nextOccurrence, addDays, parseWeekdays } from '../public/recurrence.js';
import { localDate, summarize, payrollCsv, weekStartOf } from './payroll.js';
import { buildPayrollEmail } from './email.js';

const SESSION_DAYS = 30;
const DATE_RE = /^\d{4}-\d{2}-\d{2}$/;

class HttpError extends Error {
  constructor(status, message) {
    super(message);
    this.status = status;
  }
}

const json = (data, status = 200, headers = {}) =>
  new Response(JSON.stringify(data), {
    status,
    headers: { 'Content-Type': 'application/json', 'Cache-Control': 'no-store', ...headers },
  });

const nowIso = () => new Date().toISOString();

// ---------- small validation helpers ----------
function str(v, max = 200, required = false, field = 'value') {
  const s = v == null ? '' : String(v).trim();
  if (required && !s) throw new HttpError(400, `${field} is required`);
  if (s.length > max) throw new HttpError(400, `${field} is too long`);
  return s;
}
function optDate(v, field = 'date') {
  if (v == null || v === '') return null;
  if (!DATE_RE.test(v)) throw new HttpError(400, `${field} must be YYYY-MM-DD`);
  return v;
}
function optNum(v) {
  if (v == null || v === '') return null;
  const n = Number(v);
  if (!Number.isFinite(n)) throw new HttpError(400, 'Invalid number');
  return n;
}
function optInt(v, min = 0, max = 100000) {
  const n = optNum(v);
  if (n == null) return null;
  return Math.min(max, Math.max(min, Math.round(n)));
}

// ---------- settings ----------
async function getSettings(env) {
  const { results } = await env.DB.prepare('SELECT key, value FROM settings').all();
  const s = {};
  for (const r of results) s[r.key] = r.value;
  return s;
}
const today = (settings) => localDate(nowIso(), settings.timezone || 'America/Chicago');

// ---------- auth ----------
async function currentUser(request, env) {
  const token = getCookie(request, 'sid');
  if (!token) return null;
  return env.DB.prepare(
    `SELECT u.id, u.name, u.username, u.role FROM sessions s JOIN users u ON u.id = s.user_id
     WHERE s.token = ? AND s.expires_at > ? AND u.active = 1`
  ).bind(token, nowIso()).first();
}

async function startSession(env, userId) {
  const token = randomHex(32);
  const expires = new Date(Date.now() + SESSION_DAYS * 86400000).toISOString();
  await env.DB.batch([
    env.DB.prepare('DELETE FROM sessions WHERE expires_at < ?').bind(nowIso()),
    env.DB.prepare('INSERT INTO sessions (token, user_id, expires_at) VALUES (?, ?, ?)').bind(token, userId, expires),
  ]);
  return sessionCookie(token, SESSION_DAYS * 86400);
}

function requireOwner(user) {
  if (user.role !== 'owner') throw new HttpError(403, 'Owner only');
}

// ---------- routing ----------
const routes = [];
const route = (method, pattern, handler, opts = {}) => {
  const keys = [];
  const re = new RegExp(
    '^' + pattern.replace(/:(\w+)/g, (_, k) => (keys.push(k), '([^/]+)')) + '$'
  );
  routes.push({ method, re, keys, handler, ...opts });
};

async function handleApi(request, env, url) {
  const method = request.method;
  for (const r of routes) {
    if (r.method !== method) continue;
    const m = url.pathname.match(r.re);
    if (!m) continue;
    const params = {};
    r.keys.forEach((k, i) => (params[k] = decodeURIComponent(m[i + 1])));

    if (method !== 'GET' && request.headers.get('X-Ranch') !== '1') {
      throw new HttpError(403, 'Missing request header');
    }
    const user = r.public ? null : await currentUser(request, env);
    if (!r.public && !user) throw new HttpError(401, 'Please log in');
    let body = {};
    if (method !== 'GET' && method !== 'DELETE') {
      body = await request.json().catch(() => ({}));
    }
    return r.handler({ request, env, url, params, user, body });
  }
  throw new HttpError(404, 'Not found');
}

// ===== Setup / login =====
route('GET', '/api/status', async ({ request, env }) => {
  const count = await env.DB.prepare('SELECT COUNT(*) AS n FROM users').first('n');
  const user = await currentUser(request, env);
  const settings = await getSettings(env);
  return json({
    needsSetup: count === 0,
    user,
    settings,
    today: today(settings),
    emailEnabled: Boolean(env.PAYROLL_MAILER && env.PAYROLL_FROM),
  });
}, { public: true });

route('POST', '/api/setup', async ({ env, body }) => {
  const count = await env.DB.prepare('SELECT COUNT(*) AS n FROM users').first('n');
  if (count > 0) throw new HttpError(400, 'Setup already done');
  const name = str(body.name, 80, true, 'Name');
  const username = str(body.username, 40, true, 'Username');
  const password = String(body.password || '');
  if (password.length < 6) throw new HttpError(400, 'Owner password must be at least 6 characters');
  const { hash, salt } = await hashPassword(password);
  const res = await env.DB.prepare(
    "INSERT INTO users (name, username, pass_hash, pass_salt, role) VALUES (?, ?, ?, ?, 'owner')"
  ).bind(name, username, hash, salt).run();
  if (body.ranch_name) {
    await env.DB.prepare("UPDATE settings SET value = ? WHERE key = 'ranch_name'").bind(str(body.ranch_name, 80)).run();
  }
  if (body.timezone) {
    await env.DB.prepare("UPDATE settings SET value = ? WHERE key = 'timezone'").bind(validTz(body.timezone)).run();
  }
  const cookie = await startSession(env, res.meta.last_row_id);
  return json({ ok: true }, 200, { 'Set-Cookie': cookie });
}, { public: true });

route('POST', '/api/login', async ({ env, body }) => {
  const username = str(body.username, 40, true, 'Username');
  const password = String(body.password || '');
  const u = await env.DB.prepare('SELECT * FROM users WHERE username = ? AND active = 1').bind(username).first();
  if (u && u.locked_until && u.locked_until > nowIso()) {
    throw new HttpError(429, 'Too many failed attempts. Try again in 15 minutes.');
  }
  if (!u || !(await verifyPassword(password, u.pass_hash, u.pass_salt))) {
    if (u) {
      const fails = u.failed_logins + 1;
      const lock = fails >= 8 ? new Date(Date.now() + 15 * 60000).toISOString() : null;
      await env.DB.prepare('UPDATE users SET failed_logins = ?, locked_until = ? WHERE id = ?')
        .bind(lock ? 0 : fails, lock, u.id).run();
    }
    throw new HttpError(401, 'Wrong username or password');
  }
  await env.DB.prepare('UPDATE users SET failed_logins = 0, locked_until = NULL WHERE id = ?').bind(u.id).run();
  const cookie = await startSession(env, u.id);
  return json({ ok: true }, 200, { 'Set-Cookie': cookie });
}, { public: true });

route('POST', '/api/logout', async ({ request, env }) => {
  const token = getCookie(request, 'sid');
  if (token) await env.DB.prepare('DELETE FROM sessions WHERE token = ?').bind(token).run();
  return json({ ok: true }, 200, { 'Set-Cookie': sessionCookie('', 0) });
}, { public: true });

route('POST', '/api/me/password', async ({ env, user, body }) => {
  const u = await env.DB.prepare('SELECT * FROM users WHERE id = ?').bind(user.id).first();
  if (!(await verifyPassword(String(body.current || ''), u.pass_hash, u.pass_salt))) {
    throw new HttpError(400, 'Current password is wrong');
  }
  const pw = String(body.password || '');
  if (pw.length < 4) throw new HttpError(400, 'New password/PIN must be at least 4 characters');
  const { hash, salt } = await hashPassword(pw);
  await env.DB.prepare('UPDATE users SET pass_hash = ?, pass_salt = ? WHERE id = ?').bind(hash, salt, user.id).run();
  return json({ ok: true });
});

// ===== Users =====
route('GET', '/api/users', async ({ env, user }) => {
  const cols = user.role === 'owner' ? 'id, name, username, role, active, created_at' : 'id, name, role, active';
  const { results } = await env.DB.prepare(`SELECT ${cols} FROM users ORDER BY active DESC, name`).all();
  return json(results);
});

route('POST', '/api/users', async ({ env, user, body }) => {
  requireOwner(user);
  const name = str(body.name, 80, true, 'Name');
  const username = str(body.username, 40, true, 'Username');
  const role = body.role === 'owner' ? 'owner' : 'hand';
  const pw = String(body.password || '');
  if (pw.length < 4) throw new HttpError(400, 'Password/PIN must be at least 4 characters');
  const exists = await env.DB.prepare('SELECT id FROM users WHERE username = ?').bind(username).first();
  if (exists) throw new HttpError(400, 'That username is taken');
  const { hash, salt } = await hashPassword(pw);
  await env.DB.prepare('INSERT INTO users (name, username, pass_hash, pass_salt, role) VALUES (?, ?, ?, ?, ?)')
    .bind(name, username, hash, salt, role).run();
  return json({ ok: true });
});

route('PUT', '/api/users/:id', async ({ env, user, params, body }) => {
  requireOwner(user);
  const id = Number(params.id);
  const target = await env.DB.prepare('SELECT * FROM users WHERE id = ?').bind(id).first();
  if (!target) throw new HttpError(404, 'User not found');
  const role = body.role === 'owner' ? 'owner' : body.role === 'hand' ? 'hand' : target.role;
  const active = body.active == null ? target.active : body.active ? 1 : 0;
  if (id === user.id && (role !== 'owner' || !active)) {
    throw new HttpError(400, "You can't demote or deactivate yourself");
  }
  const name = body.name != null ? str(body.name, 80, true, 'Name') : target.name;
  const stmts = [
    env.DB.prepare('UPDATE users SET name = ?, role = ?, active = ? WHERE id = ?').bind(name, role, active, id),
  ];
  if (body.password) {
    if (String(body.password).length < 4) throw new HttpError(400, 'Password/PIN must be at least 4 characters');
    const { hash, salt } = await hashPassword(String(body.password));
    stmts.push(env.DB.prepare('UPDATE users SET pass_hash = ?, pass_salt = ?, failed_logins = 0, locked_until = NULL WHERE id = ?').bind(hash, salt, id));
  }
  if (!active || body.password) stmts.push(env.DB.prepare('DELETE FROM sessions WHERE user_id = ?').bind(id));
  await env.DB.batch(stmts);
  return json({ ok: true });
});

// ===== Settings =====
function validTz(tz) {
  try {
    new Intl.DateTimeFormat('en-US', { timeZone: tz });
    return tz;
  } catch {
    throw new HttpError(400, 'Unknown time zone');
  }
}

route('PUT', '/api/settings', async ({ env, user, body }) => {
  requireOwner(user);
  const allowed = {
    ranch_name: (v) => str(v, 80, true, 'Ranch name'),
    timezone: validTz,
    week_start: (v) => (String(v) === '1' ? '1' : '0'),
    overtime_hours: (v) => String(optInt(v, 1, 168) ?? 40),
    payroll_email: (v) => {
      const s = str(v, 200);
      if (s && !/^[^@\s]+@[^@\s]+\.[^@\s]+$/.test(s)) throw new HttpError(400, 'Invalid payroll email');
      return s;
    },
    payroll_auto_email: (v) => (v === true || v === '1' ? '1' : '0'),
    map_lat: (v) => String(optNum(v) ?? 36),
    map_lng: (v) => String(optNum(v) ?? -95),
    map_zoom: (v) => String(optInt(v, 1, 20) ?? 14),
  };
  const stmts = [];
  for (const [k, fn] of Object.entries(allowed)) {
    if (k in body) stmts.push(env.DB.prepare('UPDATE settings SET value = ? WHERE key = ?').bind(fn(body[k]), k));
  }
  if (stmts.length) await env.DB.batch(stmts);
  return json(await getSettings(env));
});

// ===== Guides (reusable instructions) =====
route('GET', '/api/guides', async ({ env }) => {
  const { results } = await env.DB.prepare(
    `SELECT g.id, g.title, g.category, g.updated_at, substr(g.body, 1, 160) AS preview,
       (SELECT COUNT(*) FROM tasks t WHERE t.guide_id = g.id AND t.status = 'open') AS task_count
     FROM guides g ORDER BY g.category, g.title`
  ).all();
  return json(results);
});

route('GET', '/api/guides/:id', async ({ env, params }) => {
  const g = await env.DB.prepare(
    `SELECT g.*, u.name AS updated_by_name FROM guides g LEFT JOIN users u ON u.id = g.updated_by WHERE g.id = ?`
  ).bind(Number(params.id)).first();
  if (!g) throw new HttpError(404, 'Guide not found');
  const { results: tasks } = await env.DB.prepare(
    "SELECT id, title, due_date FROM tasks WHERE guide_id = ? AND status = 'open' ORDER BY due_date"
  ).bind(g.id).all();
  return json({ ...g, tasks });
});

function guideFields(body) {
  return {
    title: str(body.title, 120, true, 'Title'),
    category: str(body.category, 40) || 'Other',
    body: str(body.body, 50000),
  };
}

route('POST', '/api/guides', async ({ env, user, body }) => {
  const g = guideFields(body);
  const res = await env.DB.prepare(
    'INSERT INTO guides (title, category, body, created_by, updated_by) VALUES (?, ?, ?, ?, ?)'
  ).bind(g.title, g.category, g.body, user.id, user.id).run();
  return json({ id: res.meta.last_row_id });
});

route('PUT', '/api/guides/:id', async ({ env, user, params, body }) => {
  const g = guideFields(body);
  const res = await env.DB.prepare(
    'UPDATE guides SET title = ?, category = ?, body = ?, updated_by = ?, updated_at = ? WHERE id = ?'
  ).bind(g.title, g.category, g.body, user.id, nowIso(), Number(params.id)).run();
  if (!res.meta.changes) throw new HttpError(404, 'Guide not found');
  return json({ ok: true });
});

route('DELETE', '/api/guides/:id', async ({ env, user, params }) => {
  requireOwner(user);
  const id = Number(params.id);
  await env.DB.batch([
    env.DB.prepare('UPDATE tasks SET guide_id = NULL WHERE guide_id = ?').bind(id),
    env.DB.prepare('DELETE FROM guides WHERE id = ?').bind(id),
  ]);
  return json({ ok: true });
});

// ===== Tasks =====
const TASK_SELECT = `SELECT t.*, a.name AS assigned_name, c.name AS created_by_name, g.title AS guide_title,
  (SELECT MAX(completed_at) FROM completions x WHERE x.task_id = t.id) AS last_completed_at
  FROM tasks t
  LEFT JOIN users a ON a.id = t.assigned_to
  LEFT JOIN users c ON c.id = t.created_by
  LEFT JOIN guides g ON g.id = t.guide_id`;

route('GET', '/api/tasks', async ({ env, url }) => {
  const status = url.searchParams.get('status') || 'open';
  if (!['open', 'done', 'archived'].includes(status)) throw new HttpError(400, 'Bad status');
  const { results } = await env.DB.prepare(
    `${TASK_SELECT} WHERE t.status = ? ORDER BY t.due_date IS NULL, t.due_date,
     CASE t.priority WHEN 'high' THEN 0 WHEN 'normal' THEN 1 ELSE 2 END, t.title LIMIT 1000`
  ).bind(status).all();
  return json(results);
});

route('GET', '/api/tasks/:id', async ({ env, params }) => {
  const task = await env.DB.prepare(`${TASK_SELECT} WHERE t.id = ?`).bind(Number(params.id)).first();
  if (!task) throw new HttpError(404, 'Task not found');
  const guide = task.guide_id
    ? await env.DB.prepare('SELECT id, title, category, body FROM guides WHERE id = ?').bind(task.guide_id).first()
    : null;
  const { results: history } = await env.DB.prepare(
    `SELECT c.*, u.name AS user_name, r.name AS reviewer_name FROM completions c
     JOIN users u ON u.id = c.user_id LEFT JOIN users r ON r.id = c.reviewed_by
     WHERE c.task_id = ? ORDER BY c.completed_at DESC LIMIT 50`
  ).bind(task.id).all();
  return json({ ...task, guide, history });
});

async function taskFields(env, body, settings) {
  const recur_type = ['daily', 'weekly', 'monthly', 'yearly'].includes(body.recur_type) ? body.recur_type : 'none';
  const t = {
    title: str(body.title, 160, true, 'Title'),
    description: str(body.description, 10000),
    guide_id: optInt(body.guide_id, 1, 1e9),
    assigned_to: optInt(body.assigned_to, 1, 1e9),
    priority: ['low', 'normal', 'high'].includes(body.priority) ? body.priority : 'normal',
    due_date: optDate(body.due_date, 'Due date'),
    recur_type,
    recur_interval: recur_type === 'none' ? 1 : optInt(body.recur_interval, 1, 52) || 1,
    recur_weekdays: recur_type === 'weekly' ? parseWeekdays(body.recur_weekdays).join(',') : '',
    est_minutes: optInt(body.est_minutes, 0, 100000),
    lat: optNum(body.lat),
    lng: optNum(body.lng),
    location_name: str(body.location_name, 120),
  };
  if ((t.lat == null) !== (t.lng == null)) throw new HttpError(400, 'Location needs both latitude and longitude');
  if (t.lat != null && (Math.abs(t.lat) > 90 || Math.abs(t.lng) > 180)) throw new HttpError(400, 'Location out of range');
  if (t.recur_type !== 'none') {
    // Recurring tasks need a start date; the schedule is computed from it.
    if (!t.due_date) t.due_date = today(settings);
    t.recur_anchor = t.due_date;
    // For "weekly on Mon/Wed/Fri" make sure the first due date is a real occurrence.
    const first = nextOccurrence(t, addDays(t.due_date, -1));
    if (first) t.due_date = first;
  } else {
    t.recur_anchor = null;
  }
  if (t.assigned_to) {
    const ok = await env.DB.prepare('SELECT id FROM users WHERE id = ?').bind(t.assigned_to).first();
    if (!ok) throw new HttpError(400, 'Unknown assignee');
  }
  if (t.guide_id) {
    const ok = await env.DB.prepare('SELECT id FROM guides WHERE id = ?').bind(t.guide_id).first();
    if (!ok) throw new HttpError(400, 'Unknown guide');
  }
  return t;
}

route('POST', '/api/tasks', async ({ env, user, body }) => {
  const settings = await getSettings(env);
  const t = await taskFields(env, body, settings);
  const res = await env.DB.prepare(
    `INSERT INTO tasks (title, description, guide_id, assigned_to, priority, due_date, recur_type, recur_interval,
       recur_weekdays, recur_anchor, est_minutes, lat, lng, location_name, created_by)
     VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?)`
  ).bind(t.title, t.description, t.guide_id, t.assigned_to, t.priority, t.due_date, t.recur_type, t.recur_interval,
    t.recur_weekdays, t.recur_anchor, t.est_minutes, t.lat, t.lng, t.location_name, user.id).run();
  return json({ id: res.meta.last_row_id });
});

async function loadTaskForEdit(env, user, id) {
  const task = await env.DB.prepare('SELECT * FROM tasks WHERE id = ?').bind(id).first();
  if (!task) throw new HttpError(404, 'Task not found');
  if (user.role !== 'owner' && task.created_by !== user.id) {
    throw new HttpError(403, 'Only the owner or the person who created this task can change it');
  }
  return task;
}

route('PUT', '/api/tasks/:id', async ({ env, user, params, body }) => {
  const id = Number(params.id);
  const existing = await loadTaskForEdit(env, user, id);
  const settings = await getSettings(env);
  const t = await taskFields(env, body, settings);
  // Keep the original schedule anchor if the rule itself didn't change.
  if (t.recur_type !== 'none' && existing.recur_anchor && existing.recur_type === t.recur_type &&
      existing.recur_interval === t.recur_interval && existing.recur_weekdays === t.recur_weekdays &&
      existing.due_date === body.due_date) {
    t.recur_anchor = existing.recur_anchor;
  }
  const status = body.status === 'open' && existing.status !== 'open' ? 'open' : existing.status;
  await env.DB.prepare(
    `UPDATE tasks SET title = ?, description = ?, guide_id = ?, assigned_to = ?, priority = ?, due_date = ?,
       recur_type = ?, recur_interval = ?, recur_weekdays = ?, recur_anchor = ?, est_minutes = ?, lat = ?, lng = ?,
       location_name = ?, status = ?, updated_at = ? WHERE id = ?`
  ).bind(t.title, t.description, t.guide_id, t.assigned_to, t.priority, t.due_date, t.recur_type, t.recur_interval,
    t.recur_weekdays, t.recur_anchor, t.est_minutes, t.lat, t.lng, t.location_name, status, nowIso(), id).run();
  return json({ ok: true });
});

route('DELETE', '/api/tasks/:id', async ({ env, user, params }) => {
  const id = Number(params.id);
  await loadTaskForEdit(env, user, id);
  // Archive rather than delete so completion history and productivity stats survive.
  await env.DB.prepare("UPDATE tasks SET status = 'archived', updated_at = ? WHERE id = ?").bind(nowIso(), id).run();
  return json({ ok: true });
});

route('POST', '/api/tasks/:id/complete', async ({ env, user, params, body }) => {
  const id = Number(params.id);
  const task = await env.DB.prepare('SELECT * FROM tasks WHERE id = ?').bind(id).first();
  if (!task) throw new HttpError(404, 'Task not found');
  if (task.status !== 'open') throw new HttpError(400, 'This task is already closed');
  const settings = await getSettings(env);
  const day = today(settings);
  const stmts = [
    env.DB.prepare(
      `INSERT INTO completions (task_id, task_title, user_id, completed_at, completed_on, due_date, minutes_spent, notes)
       VALUES (?, ?, ?, ?, ?, ?, ?, ?)`
    ).bind(id, task.title, user.id, nowIso(), day, task.due_date, optInt(body.minutes_spent, 0, 100000), str(body.notes, 5000)),
  ];
  let next = null;
  if (task.recur_type !== 'none') {
    next = nextDueAfterCompletion(task, day);
    stmts.push(env.DB.prepare('UPDATE tasks SET due_date = ?, updated_at = ? WHERE id = ?').bind(next, nowIso(), id));
  } else {
    stmts.push(env.DB.prepare("UPDATE tasks SET status = 'done', updated_at = ? WHERE id = ?").bind(nowIso(), id));
  }
  await env.DB.batch(stmts);
  return json({ ok: true, next_due: next });
});

// ===== Completions & owner review =====
route('GET', '/api/completions', async ({ env, url, user }) => {
  const where = [];
  const args = [];
  const status = url.searchParams.get('review');
  if (status) { where.push('c.review_status = ?'); args.push(status); }
  const from = optDate(url.searchParams.get('from'));
  const to = optDate(url.searchParams.get('to'));
  if (from) { where.push('c.completed_on >= ?'); args.push(from); }
  if (to) { where.push('c.completed_on <= ?'); args.push(to); }
  const uid = user.role === 'owner' ? optInt(url.searchParams.get('user_id'), 1, 1e9) : user.id;
  if (uid) { where.push('c.user_id = ?'); args.push(uid); }
  const { results } = await env.DB.prepare(
    `SELECT c.*, u.name AS user_name, r.name AS reviewer_name, t.guide_id, t.lat, t.lng
     FROM completions c JOIN users u ON u.id = c.user_id LEFT JOIN users r ON r.id = c.reviewed_by
     LEFT JOIN tasks t ON t.id = c.task_id
     ${where.length ? 'WHERE ' + where.join(' AND ') : ''} ORDER BY c.completed_at DESC LIMIT 500`
  ).bind(...args).all();
  return json(results);
});

route('POST', '/api/completions/:id/review', async ({ env, user, params, body }) => {
  requireOwner(user);
  const status = body.status === 'flagged' ? 'flagged' : body.status === 'approved' ? 'approved' : 'pending';
  const res = await env.DB.prepare(
    'UPDATE completions SET review_status = ?, review_note = ?, reviewed_by = ?, reviewed_at = ? WHERE id = ?'
  ).bind(status, str(body.note, 2000), status === 'pending' ? null : user.id, status === 'pending' ? null : nowIso(), Number(params.id)).run();
  if (!res.meta.changes) throw new HttpError(404, 'Not found');
  if (status === 'flagged' && body.reopen) {
    // Put a one-off task back on the list so someone redoes it.
    const c = await env.DB.prepare('SELECT task_id FROM completions WHERE id = ?').bind(Number(params.id)).first();
    await env.DB.prepare("UPDATE tasks SET status = 'open', updated_at = ? WHERE id = ? AND status = 'done'")
      .bind(nowIso(), c.task_id).run();
  }
  return json({ ok: true });
});

route('POST', '/api/completions/approve-all', async ({ env, user }) => {
  requireOwner(user);
  const res = await env.DB.prepare(
    "UPDATE completions SET review_status = 'approved', reviewed_by = ?, reviewed_at = ? WHERE review_status = 'pending'"
  ).bind(user.id, nowIso()).run();
  return json({ approved: res.meta.changes });
});

// ===== Time clock =====
route('GET', '/api/time/status', async ({ env, user }) => {
  const open = await env.DB.prepare(
    'SELECT * FROM time_entries WHERE user_id = ? AND clock_out IS NULL ORDER BY clock_in DESC LIMIT 1'
  ).bind(user.id).first();
  const settings = await getSettings(env);
  const day = today(settings);
  const weekFrom = weekStartOf(day, Number(settings.week_start || 0));
  const { results } = await env.DB.prepare(
    'SELECT * FROM time_entries WHERE user_id = ? AND work_date >= ?'
  ).bind(user.id, weekFrom).all();
  const s = summarize(results.map((r) => ({ ...r, name: user.name })), {
    weekStart: Number(settings.week_start || 0), overtimeHours: Number(settings.overtime_hours || 40),
  })[0];
  return json({ open, todayHours: s?.days[day] || 0, weekHours: s?.total || 0 });
});

route('POST', '/api/time/clock-in', async ({ env, user, body }) => {
  const open = await env.DB.prepare('SELECT id FROM time_entries WHERE user_id = ? AND clock_out IS NULL').bind(user.id).first();
  if (open) throw new HttpError(400, 'You are already clocked in');
  const settings = await getSettings(env);
  const t = nowIso();
  await env.DB.prepare(
    'INSERT INTO time_entries (user_id, clock_in, work_date, in_lat, in_lng, note) VALUES (?, ?, ?, ?, ?, ?)'
  ).bind(user.id, t, localDate(t, settings.timezone), optNum(body.lat), optNum(body.lng), str(body.note, 500)).run();
  return json({ ok: true });
});

route('POST', '/api/time/clock-out', async ({ env, user, body }) => {
  const open = await env.DB.prepare(
    'SELECT * FROM time_entries WHERE user_id = ? AND clock_out IS NULL ORDER BY clock_in DESC LIMIT 1'
  ).bind(user.id).first();
  if (!open) throw new HttpError(400, 'You are not clocked in');
  const note = [open.note, str(body.note, 500)].filter(Boolean).join(' / ');
  await env.DB.prepare('UPDATE time_entries SET clock_out = ?, out_lat = ?, out_lng = ?, note = ? WHERE id = ?')
    .bind(nowIso(), optNum(body.lat), optNum(body.lng), note, open.id).run();
  return json({ ok: true });
});

function rangeParams(url, settings) {
  const day = today(settings);
  const to = optDate(url.searchParams.get('to')) || day;
  const from = optDate(url.searchParams.get('from')) || addDays(to, -13);
  if (from > to) throw new HttpError(400, '"From" must be before "to"');
  return { from, to };
}

async function timeEntries(env, from, to, userId) {
  const { results } = await env.DB.prepare(
    `SELECT e.*, u.name, ed.name AS edited_by_name FROM time_entries e JOIN users u ON u.id = e.user_id
     LEFT JOIN users ed ON ed.id = e.edited_by
     WHERE e.work_date >= ? AND e.work_date <= ? ${userId ? 'AND e.user_id = ?' : ''}
     ORDER BY e.clock_in DESC`
  ).bind(...[from, to, userId].filter((x) => x != null)).all();
  return results;
}

route('GET', '/api/time', async ({ env, url, user }) => {
  const settings = await getSettings(env);
  const { from, to } = rangeParams(url, settings);
  const uid = user.role === 'owner' ? optInt(url.searchParams.get('user_id'), 1, 1e9) : user.id;
  return json(await timeEntries(env, from, to, uid));
});

function parseIso(v, field) {
  if (v == null || v === '') return null;
  const d = new Date(v);
  if (isNaN(d)) throw new HttpError(400, `Invalid ${field}`);
  return d.toISOString();
}

route('POST', '/api/time', async ({ env, user, body }) => {
  requireOwner(user);
  const settings = await getSettings(env);
  const uid = optInt(body.user_id, 1, 1e9);
  if (!uid) throw new HttpError(400, 'Pick an employee');
  const cin = parseIso(body.clock_in, 'clock in');
  const cout = parseIso(body.clock_out, 'clock out');
  if (!cin) throw new HttpError(400, 'Clock in time is required');
  if (cout && cout <= cin) throw new HttpError(400, 'Clock out must be after clock in');
  await env.DB.prepare(
    'INSERT INTO time_entries (user_id, clock_in, clock_out, work_date, note, edited_by) VALUES (?, ?, ?, ?, ?, ?)'
  ).bind(uid, cin, cout, localDate(cin, settings.timezone), str(body.note, 500), user.id).run();
  return json({ ok: true });
});

route('PUT', '/api/time/:id', async ({ env, user, params, body }) => {
  requireOwner(user);
  const settings = await getSettings(env);
  const cin = parseIso(body.clock_in, 'clock in');
  const cout = parseIso(body.clock_out, 'clock out');
  if (!cin) throw new HttpError(400, 'Clock in time is required');
  if (cout && cout <= cin) throw new HttpError(400, 'Clock out must be after clock in');
  const res = await env.DB.prepare(
    'UPDATE time_entries SET clock_in = ?, clock_out = ?, work_date = ?, note = ?, edited_by = ? WHERE id = ?'
  ).bind(cin, cout, localDate(cin, settings.timezone), str(body.note, 500), user.id, Number(params.id)).run();
  if (!res.meta.changes) throw new HttpError(404, 'Not found');
  return json({ ok: true });
});

route('DELETE', '/api/time/:id', async ({ env, user, params }) => {
  requireOwner(user);
  await env.DB.prepare('DELETE FROM time_entries WHERE id = ?').bind(Number(params.id)).run();
  return json({ ok: true });
});

// ===== Payroll =====
async function payrollData(env, from, to) {
  const settings = await getSettings(env);
  const entries = await timeEntries(env, from, to, null);
  const summary = summarize(entries, {
    weekStart: Number(settings.week_start || 0),
    overtimeHours: Number(settings.overtime_hours || 40),
  });
  return { settings, entries, summary };
}

route('GET', '/api/payroll', async ({ env, url, user }) => {
  requireOwner(user);
  const settings = await getSettings(env);
  const { from, to } = rangeParams(url, settings);
  const { summary, entries } = await payrollData(env, from, to);
  return json({ from, to, summary, openEntries: entries.filter((e) => !e.clock_out).length });
});

route('GET', '/api/payroll.csv', async ({ env, url, user }) => {
  requireOwner(user);
  const settings = await getSettings(env);
  const { from, to } = rangeParams(url, settings);
  const { entries, summary } = await payrollData(env, from, to);
  const csv = payrollCsv(entries, summary, { tz: settings.timezone, from, to });
  return new Response(csv, {
    headers: {
      'Content-Type': 'text/csv; charset=utf-8',
      'Content-Disposition': `attachment; filename="payroll_${from}_to_${to}.csv"`,
      'Cache-Control': 'no-store',
    },
  });
});

async function emailPayroll(env, from, to) {
  if (!env.PAYROLL_MAILER || !env.PAYROLL_FROM) {
    throw new HttpError(400, 'Email is not set up yet. See README "Emailing payroll".');
  }
  const { settings, entries, summary } = await payrollData(env, from, to);
  if (!settings.payroll_email) throw new HttpError(400, 'Set the payroll email address in Settings first');
  const csv = payrollCsv(entries, summary, { tz: settings.timezone, from, to });
  const lines = summary.map((s) => `${s.name}: ${s.total.toFixed(2)} hrs (${s.regular.toFixed(2)} reg, ${s.overtime.toFixed(2)} OT)`);
  const raw = buildPayrollEmail({
    from: env.PAYROLL_FROM,
    to: settings.payroll_email,
    subject: `${settings.ranch_name} payroll ${from} to ${to}`,
    text: `Hours for ${from} through ${to}:\n\n${lines.join('\n') || 'No hours recorded.'}\n\nDetailed timesheet attached (CSV).`,
    filename: `payroll_${from}_to_${to}.csv`,
    csv,
  });
  await env.PAYROLL_MAILER.send(new EmailMessage(env.PAYROLL_FROM, settings.payroll_email, raw));
  return settings.payroll_email;
}

route('POST', '/api/payroll/email', async ({ env, user, body }) => {
  requireOwner(user);
  const from = optDate(body.from, 'from');
  const to = optDate(body.to, 'to');
  if (!from || !to) throw new HttpError(400, 'Pick a date range');
  const sentTo = await emailPayroll(env, from, to);
  return json({ ok: true, sentTo });
});

// ===== Productivity stats =====
route('GET', '/api/stats', async ({ env, url, user }) => {
  const settings = await getSettings(env);
  const { from, to } = rangeParams(url, settings);
  const onlyMe = user.role !== 'owner';
  const { results: users } = await env.DB.prepare(
    `SELECT id, name, role FROM users WHERE active = 1 ${onlyMe ? 'AND id = ?' : ''} ORDER BY name`
  ).bind(...(onlyMe ? [user.id] : [])).all();
  const { results: comp } = await env.DB.prepare(
    `SELECT user_id, COUNT(*) AS completed, COALESCE(SUM(minutes_spent), 0) AS task_minutes,
       SUM(CASE WHEN due_date IS NULL OR completed_on <= due_date THEN 1 ELSE 0 END) AS on_time,
       SUM(review_status = 'approved') AS approved, SUM(review_status = 'flagged') AS flagged,
       SUM(review_status = 'pending') AS pending
     FROM completions WHERE completed_on >= ? AND completed_on <= ? GROUP BY user_id`
  ).bind(from, to).all();
  const entries = await timeEntries(env, from, to, onlyMe ? user.id : null);
  const hours = summarize(entries, {
    weekStart: Number(settings.week_start || 0), overtimeHours: Number(settings.overtime_hours || 40),
  });
  const { results: daily } = await env.DB.prepare(
    `SELECT completed_on AS day, user_id, COUNT(*) AS n FROM completions
     WHERE completed_on >= ? AND completed_on <= ? ${onlyMe ? 'AND user_id = ?' : ''}
     GROUP BY completed_on, user_id`
  ).bind(...[from, to].concat(onlyMe ? [user.id] : [])).all();
  const rows = users.map((u) => {
    const c = comp.find((x) => x.user_id === u.id) || {};
    const h = hours.find((x) => x.user_id === u.id);
    const total = h ? h.total : 0;
    return {
      user_id: u.id,
      name: u.name,
      role: u.role,
      hours: total,
      overtime: h ? h.overtime : 0,
      days_worked: h ? Object.keys(h.days).length : 0,
      completed: c.completed || 0,
      task_minutes: c.task_minutes || 0,
      on_time: c.on_time || 0,
      approved: c.approved || 0,
      flagged: c.flagged || 0,
      pending: c.pending || 0,
      tasks_per_day: h && Object.keys(h.days).length ? (c.completed || 0) / Object.keys(h.days).length : 0,
      utilization: total > 0 ? (c.task_minutes || 0) / 60 / total : null,
    };
  });
  return json({ from, to, rows, daily });
});

// ===== Map layers =====
route('GET', '/api/layers', async ({ env }) => {
  const { results } = await env.DB.prepare('SELECT id, name, color, visible, geojson FROM map_layers ORDER BY name').all();
  return json(results.map((r) => ({ ...r, geojson: JSON.parse(r.geojson) })));
});

route('POST', '/api/layers', async ({ env, user, body }) => {
  const name = str(body.name, 120, true, 'Layer name');
  const color = /^#[0-9a-fA-F]{6}$/.test(body.color || '') ? body.color : '#ff7800';
  const gj = body.geojson;
  if (!gj || gj.type !== 'FeatureCollection' || !Array.isArray(gj.features)) {
    throw new HttpError(400, 'Layer must be a GeoJSON FeatureCollection');
  }
  const text = JSON.stringify(gj);
  if (text.length > 900000) throw new HttpError(400, 'That file is too large (max ~900 KB after conversion)');
  const res = await env.DB.prepare('INSERT INTO map_layers (name, color, geojson, created_by) VALUES (?, ?, ?, ?)')
    .bind(name, color, text, user.id).run();
  return json({ id: res.meta.last_row_id });
});

route('PUT', '/api/layers/:id', async ({ env, user, params, body }) => {
  requireOwner(user);
  const color = /^#[0-9a-fA-F]{6}$/.test(body.color || '') ? body.color : '#ff7800';
  await env.DB.prepare('UPDATE map_layers SET name = ?, color = ?, visible = ? WHERE id = ?')
    .bind(str(body.name, 120, true, 'Layer name'), color, body.visible ? 1 : 0, Number(params.id)).run();
  return json({ ok: true });
});

route('DELETE', '/api/layers/:id', async ({ env, user, params }) => {
  requireOwner(user);
  await env.DB.prepare('DELETE FROM map_layers WHERE id = ?').bind(Number(params.id)).run();
  return json({ ok: true });
});

// ---------- entry points ----------
export default {
  async fetch(request, env) {
    const url = new URL(request.url);
    if (url.pathname.startsWith('/api/')) {
      try {
        return await handleApi(request, env, url);
      } catch (err) {
        if (err instanceof HttpError) return json({ error: err.message }, err.status);
        console.error(err);
        return json({ error: 'Something went wrong on the server' }, 500);
      }
    }
    // Anything else falls through to the static UI.
    return env.ASSETS.fetch(request);
  },

  // Weekly cron: email last full payroll week if auto-email is on.
  async scheduled(event, env) {
    const settings = await getSettings(env);
    if (settings.payroll_auto_email !== '1') return;
    const thisWeek = weekStartOf(today(settings), Number(settings.week_start || 0));
    const from = addDays(thisWeek, -7);
    const to = addDays(thisWeek, -1);
    try {
      await emailPayroll(env, from, to);
    } catch (err) {
      console.error('Payroll email failed', err);
    }
  },
};
