// Ranch Tasks — Cloudflare Worker API. Static UI is served from /public.
import { EmailMessage } from 'cloudflare:email';
import { hashPassword, verifyPassword, randomHex, getCookie, sessionCookie } from './auth.js';
import { nextDueAfterCompletion, nextOccurrence, addDays, parseWeekdays } from '../public/recurrence.js';
import {
  localDate, localHour, summarize, payrollCsv, payPeriodOf, previousPayPeriod, AUTO_CLOCKOUT_HOURS,
} from './payroll.js';
import { buildPayrollEmail } from './email.js';
import { parseChecklist, parseRoute } from '../public/md.js';

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
    if (method !== 'GET' && method !== 'DELETE' && !r.raw) {
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
    payroll_email: (v) => {
      const s = str(v, 200);
      if (s && !/^[^@\s]+@[^@\s]+\.[^@\s]+$/.test(s)) throw new HttpError(400, 'Invalid payroll email');
      return s;
    },
    payroll_auto_email: (v) => (v === true || v === '1' ? '1' : '0'),
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
    `SELECT g.id, g.title, g.category, g.updated_at, g.archived, substr(g.body, 1, 160) AS preview,
       (SELECT COUNT(*) FROM tasks t WHERE t.guide_id = g.id AND t.status = 'open') AS task_count
     FROM guides g ORDER BY g.category, g.title`
  ).all();
  return json(results);
});

route('GET', '/api/guides/:id', async ({ env, params, user }) => {
  const g = await env.DB.prepare(
    `SELECT g.*, u.name AS updated_by_name FROM guides g LEFT JOIN users u ON u.id = g.updated_by WHERE g.id = ?`
  ).bind(Number(params.id)).first();
  if (!g) throw new HttpError(404, 'Guide not found');
  const { results: tasks } = await env.DB.prepare(
    `SELECT id, title, due_date FROM tasks t WHERE guide_id = ? AND status = 'open'${visibleSql(user)} ORDER BY due_date`
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
  requireOwner(user);
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

// Archived guides are hidden from the guide list and task form; tasks that
// already use one keep their instructions.
route('PUT', '/api/guides/:id/archive', async ({ env, user, params, body }) => {
  requireOwner(user);
  const res = await env.DB.prepare('UPDATE guides SET archived = ?, updated_at = ? WHERE id = ?')
    .bind(body.archived === false ? 0 : 1, nowIso(), Number(params.id)).run();
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
// Hands only see tasks that are unassigned or assigned to them.
const canSeeTask = (user, t) => user.role === 'owner' || !t.assigned_to || t.assigned_to === user.id;
const visibleSql = (user, alias = 't') => (user.role === 'owner' ? '' : ` AND (${alias}.assigned_to IS NULL OR ${alias}.assigned_to = ${Number(user.id)})`);

const TASK_SELECT = `SELECT t.*, a.name AS assigned_name, c.name AS created_by_name, g.title AS guide_title,
  p.name AS property_name, p.photo_type IS NOT NULL AS property_has_photo, p.photo_updated_at AS property_photo_at,
  (SELECT MAX(completed_at) FROM completions x WHERE x.task_id = t.id) AS last_completed_at
  FROM tasks t
  LEFT JOIN users a ON a.id = t.assigned_to
  LEFT JOIN users c ON c.id = t.created_by
  LEFT JOIN guides g ON g.id = t.guide_id
  LEFT JOIN properties p ON p.id = t.property_id`;

route('GET', '/api/tasks', async ({ env, url, user }) => {
  const status = url.searchParams.get('status') || 'open';
  if (!['open', 'done', 'archived'].includes(status)) throw new HttpError(400, 'Bad status');
  const order = status === 'open'
    ? `t.due_date IS NULL, t.due_date, t.rank IS NULL, t.rank,
       CASE t.priority WHEN 'high' THEN 0 WHEN 'normal' THEN 1 ELSE 2 END, t.title LIMIT 1000`
    // Finished and archived tasks pile up over the years; show the newest.
    : 't.updated_at DESC LIMIT 200';
  const { results } = await env.DB.prepare(
    `${TASK_SELECT} WHERE t.status = ?${visibleSql(user)} ORDER BY ${order}`
  ).bind(status).all();
  return json(results);
});

route('GET', '/api/tasks/:id', async ({ env, params, user }) => {
  const task = await env.DB.prepare(`${TASK_SELECT} WHERE t.id = ?`).bind(Number(params.id)).first();
  if (!task || !canSeeTask(user, task)) throw new HttpError(404, 'Task not found');
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

// Spots and lines drawn on the property photo. Coordinates are 0..1 fractions
// of the photo's width and height. Returns a JSON string, or null for none.
function parseMarks(v) {
  if (v == null || v === '') return null;
  let list = v;
  if (typeof v === 'string') {
    try { list = JSON.parse(v); } catch { throw new HttpError(400, 'Marks on the photo are invalid'); }
  }
  if (!Array.isArray(list)) throw new HttpError(400, 'Marks on the photo are invalid');
  if (list.length > 50) throw new HttpError(400, 'Too many marks on the photo (50 max)');
  const ok = (n) => typeof n === 'number' && n >= 0 && n <= 1;
  const r = (n) => Math.round(n * 10000) / 10000;
  const out = list.map((m) => {
    if (m?.type === 'pin' && ok(m.x) && ok(m.y)) return { type: 'pin', x: r(m.x), y: r(m.y) };
    if (m?.type === 'line' && Array.isArray(m.points) && m.points.length >= 2 && m.points.length <= 500 &&
        m.points.every((pt) => Array.isArray(pt) && ok(pt[0]) && ok(pt[1]))) {
      return { type: 'line', points: m.points.map((pt) => [r(pt[0]), r(pt[1])]) };
    }
    throw new HttpError(400, 'A mark on the photo is off the photo or invalid');
  });
  return out.length ? JSON.stringify(out) : null;
}

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
    location_name: str(body.location_name, 120),
    property_id: optInt(body.property_id, 1, 1e9),
    rank: optInt(body.rank, 1, 999),
    repeat_on_complete: [true, 1, '1', 'true'].includes(body.repeat_on_complete) ? 1 : 0,
  };
  t.marks = t.property_id ? parseMarks(body.marks) : null;
  // "Again as soon as it's done": a one-time, anytime task that never closes.
  if (t.repeat_on_complete) {
    t.recur_type = 'none';
    t.recur_interval = 1;
    t.recur_weekdays = '';
    t.due_date = null;
  }
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
  // Ranking only orders tasks with no due date.
  if (t.due_date) t.rank = null;
  if (t.assigned_to) {
    const ok = await env.DB.prepare('SELECT id FROM users WHERE id = ?').bind(t.assigned_to).first();
    if (!ok) throw new HttpError(400, 'Unknown assignee');
  }
  if (t.guide_id) {
    const ok = await env.DB.prepare('SELECT id FROM guides WHERE id = ?').bind(t.guide_id).first();
    if (!ok) throw new HttpError(400, 'Unknown guide');
  }
  if (t.property_id) {
    const ok = await env.DB.prepare('SELECT id FROM properties WHERE id = ?').bind(t.property_id).first();
    if (!ok) throw new HttpError(400, 'Unknown property');
  }
  return t;
}

// A hand's new task is just "what needs doing" and an estimate; it's due
// today and open to anyone.
function handTaskBody(user, body, settings) {
  return { title: body.title, est_minutes: body.est_minutes, due_date: today(settings) };
}

route('POST', '/api/tasks', async ({ env, user, body }) => {
  const settings = await getSettings(env);
  const t = await taskFields(env, user.role === 'owner' ? body : handTaskBody(user, body, settings), settings);
  const res = await env.DB.prepare(
    `INSERT INTO tasks (title, description, guide_id, assigned_to, priority, due_date, recur_type, recur_interval,
       recur_weekdays, recur_anchor, est_minutes, location_name, property_id, marks, rank, repeat_on_complete, created_by)
     VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?)`
  ).bind(t.title, t.description, t.guide_id, t.assigned_to, t.priority, t.due_date, t.recur_type, t.recur_interval,
    t.recur_weekdays, t.recur_anchor, t.est_minutes, t.location_name, t.property_id, t.marks, t.rank,
    t.repeat_on_complete, user.id).run();
  const id = res.meta.last_row_id;
  // "Save & mark complete": record the completion in the same request.
  if (body.complete) return json({ id, ...(await completeTask(env, user, id, body)) });
  return json({ id });
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
  // Hands can only change the title and estimate of tasks they created.
  const input = user.role === 'owner' ? body : { ...existing, title: body.title, est_minutes: body.est_minutes, status: body.status };
  const t = await taskFields(env, input, settings);
  // Keep the original schedule anchor if the rule itself didn't change.
  if (t.recur_type !== 'none' && existing.recur_anchor && existing.recur_type === t.recur_type &&
      existing.recur_interval === t.recur_interval && existing.recur_weekdays === t.recur_weekdays &&
      existing.due_date === input.due_date) {
    t.recur_anchor = existing.recur_anchor;
  }
  const status = input.status === 'open' && existing.status !== 'open' ? 'open' : existing.status;
  await env.DB.prepare(
    `UPDATE tasks SET title = ?, description = ?, guide_id = ?, assigned_to = ?, priority = ?, due_date = ?,
       recur_type = ?, recur_interval = ?, recur_weekdays = ?, recur_anchor = ?, est_minutes = ?,
       location_name = ?, property_id = ?, marks = ?, rank = ?, repeat_on_complete = ?, status = ?, updated_at = ?
       WHERE id = ?`
  ).bind(t.title, t.description, t.guide_id, t.assigned_to, t.priority, t.due_date, t.recur_type, t.recur_interval,
    t.recur_weekdays, t.recur_anchor, t.est_minutes, t.location_name, t.property_id, t.marks, t.rank,
    t.repeat_on_complete, status, nowIso(), id).run();
  return json({ ok: true });
});

// Guide tick-boxes on an open task are saved on the task, so everyone working
// it sees the same progress. { steps: [stepNumbers], followups: [indexes] }
function parseChecks(v) {
  try {
    const o = JSON.parse(v || '{}');
    const nums = (a) => (Array.isArray(a) ? a.map(Number).filter(Number.isInteger) : []);
    return { steps: nums(o.steps), followups: nums(o.followups), good: nums(o.good) };
  } catch {
    return { steps: [], followups: [], good: [] };
  }
}

// On a route, tapping a need (e.g. Hay at Sharpers) adds that stop to the
// supply's to-do right away; tapping it again takes it back off. "All good"
// marks a stop checked and clears any needs tapped there. Other guides just
// record which steps are ticked.
route('PUT', '/api/tasks/:id/checks', async ({ env, user, params, body }) => {
  const task = await env.DB.prepare('SELECT * FROM tasks WHERE id = ?').bind(Number(params.id)).first();
  if (!task || !canSeeTask(user, task)) throw new HttpError(404, 'Task not found');
  if (task.status !== 'open') throw new HttpError(400, 'This task is already closed');
  const index = optInt(body.index, 0, 10000);
  if (index == null) throw new HttpError(400, 'Missing tick-box');
  const on = body.checked !== false;
  const checks = parseChecks(task.guide_checks);
  const toggle = (list, i, add) => {
    const set = new Set(list);
    add ? set.add(i) : set.delete(i);
    return [...set].sort((a, b) => a - b);
  };
  const messages = [];
  if (body.kind === 'followup' || body.kind === 'good') {
    const guide = task.guide_id ? await env.DB.prepare('SELECT body FROM guides WHERE id = ?').bind(task.guide_id).first() : null;
    const { stops } = parseRoute(guide?.body);
    const day = today(await getSettings(env));
    if (body.kind === 'followup') {
      const stop = stops.find((s) => s.needs.some((n) => n.index === index));
      if (!stop) throw new HttpError(400, 'That need is not on this route');
      const need = stop.needs.find((n) => n.index === index);
      if (on !== checks.followups.includes(index)) {
        messages.push(on ? await addStopToTodo(env, user, task, need.action, stop.name, day)
          : await removeStopFromTodo(env, task, need.action, stop.name, day));
      }
      checks.followups = toggle(checks.followups, index, on);
      if (on) checks.good = toggle(checks.good, stop.index, false);
    } else {
      const stop = stops[index];
      if (!stop) throw new HttpError(400, 'That stop is not on this route');
      if (on) {
        for (const need of stop.needs.filter((n) => checks.followups.includes(n.index))) {
          messages.push(await removeStopFromTodo(env, task, need.action, stop.name, day));
          checks.followups = toggle(checks.followups, need.index, false);
        }
      }
      checks.good = toggle(checks.good, index, on);
    }
  } else {
    checks.steps = toggle(checks.steps, index, on);
  }
  await env.DB.prepare('UPDATE tasks SET guide_checks = ? WHERE id = ?').bind(JSON.stringify(checks), task.id).run();
  return json({ ok: true, checks, message: messages.filter(Boolean).join(' ') });
});

// Tick off stops on a grouped follow-up to-do ("Put out hay: Sharpers, ...").
// Saved on the task so everyone sees the same progress.
route('PUT', '/api/tasks/:id/stops', async ({ env, user, params, body }) => {
  const task = await env.DB.prepare('SELECT * FROM tasks WHERE id = ?').bind(Number(params.id)).first();
  if (!task || !canSeeTask(user, task)) throw new HttpError(404, 'Task not found');
  const stops = parseStops(task.followup_stops);
  const stop = String(body.stop ?? '');
  if (!stops.includes(stop)) throw new HttpError(400, 'That stop is not on this to-do');
  const done = new Set(parseStops(task.followup_done));
  body.done === false ? done.delete(stop) : done.add(stop);
  const list = stops.filter((x) => done.has(x));
  await env.DB.prepare('UPDATE tasks SET followup_done = ?, updated_at = ? WHERE id = ?')
    .bind(JSON.stringify(list), nowIso(), task.id).run();
  return json({ ok: true, done: list });
});

route('DELETE', '/api/tasks/:id', async ({ env, user, params }) => {
  const id = Number(params.id);
  await loadTaskForEdit(env, user, id);
  // Archive rather than delete so completion history and productivity stats survive.
  await env.DB.prepare("UPDATE tasks SET status = 'archived', updated_at = ? WHERE id = ?").bind(nowIso(), id).run();
  return json({ ok: true });
});

// Ticked follow-up items from the task's guide (e.g. "Needs hay" at Sharpers)
// are grouped into one high-priority to-do per supply, open to anyone with no
// due date: "Put out hay: Sharpers, Lake field". If that to-do is still open,
// new stops are added to it instead of making another.
function followupTitle(action, stops) {
  let title = `${action}: ${stops.join(', ')}`;
  for (let n = stops.length - 1; title.length > 160 && n > 0; n--) {
    title = `${action}: ${stops.slice(0, n).join(', ')} +${stops.length - n} more`;
  }
  return title.slice(0, 160);
}

function parseStops(v) {
  try {
    const a = JSON.parse(v || '[]');
    return Array.isArray(a) ? a.map(String) : [];
  } catch {
    return [];
  }
}

function followupDescription(stops, task, day) {
  return `Stops:\n${stops.map((x) => `• ${x}`).join('\n')}\n\nLast updated from "${task.title}" on ${day}.`;
}

async function openTodoFor(env, action) {
  return env.DB.prepare(
    "SELECT id, followup_stops, followup_done FROM tasks WHERE status = 'open' AND followup_key = ? COLLATE NOCASE ORDER BY id DESC LIMIT 1"
  ).bind(action).first();
}

// Add a stop to the open to-do for this supply, or start one (high priority,
// open to anyone, no due date).
async function addStopToTodo(env, user, task, rawAction, rawStop, day) {
  const action = rawAction.trim().slice(0, 120);
  const stop = (rawStop || 'General').slice(0, 80);
  const open = await openTodoFor(env, action);
  const before = open ? parseStops(open.followup_stops) : [];
  if (before.includes(stop)) return `${stop} is already on “${action}”.`;
  const stops = [...before, stop];
  const title = followupTitle(action, stops);
  if (open) {
    await env.DB.prepare('UPDATE tasks SET title = ?, description = ?, followup_stops = ?, updated_at = ? WHERE id = ?')
      .bind(title, followupDescription(stops, task, day), JSON.stringify(stops), nowIso(), open.id).run();
  } else {
    await env.DB.prepare(
      `INSERT INTO tasks (title, description, priority, due_date, created_by, followup_key, followup_stops)
       VALUES (?, ?, 'high', NULL, ?, ?, ?)`
    ).bind(title, followupDescription(stops, task, day), user.id, action, JSON.stringify(stops)).run();
  }
  return `Added ${stop} to “${action}”.`;
}

// Take a stop back off its supply's to-do (a mis-tap). A stop someone already
// marked done there stays; a to-do left with no stops is archived.
async function removeStopFromTodo(env, task, rawAction, rawStop, day) {
  const action = rawAction.trim().slice(0, 120);
  const stop = (rawStop || 'General').slice(0, 80);
  const open = await openTodoFor(env, action);
  const before = open ? parseStops(open.followup_stops) : [];
  if (!before.includes(stop)) return '';
  if (parseStops(open.followup_done).includes(stop)) return `${stop} was already done on “${action}”, so it stays there.`;
  const stops = before.filter((x) => x !== stop);
  if (!stops.length) {
    await env.DB.prepare("UPDATE tasks SET status = 'archived', updated_at = ? WHERE id = ?").bind(nowIso(), open.id).run();
    return `Removed “${action}” (no stops left).`;
  }
  await env.DB.prepare('UPDATE tasks SET title = ?, description = ?, followup_stops = ?, updated_at = ? WHERE id = ?')
    .bind(followupTitle(action, stops), followupDescription(stops, task, day), JSON.stringify(stops), nowIso(), open.id).run();
  return `Took ${stop} off “${action}”.`;
}

// What was ticked when the task was completed, kept with the completion so the
// owner can review it: guide steps and stops (ticked or not), needs reported,
// and stops done on a grouped to-do. Labels are stored, so later guide edits
// don't change old records.
async function checklistSnapshot(env, task) {
  const out = {};
  const guide = task.guide_id ? await env.DB.prepare('SELECT body FROM guides WHERE id = ?').bind(task.guide_id).first() : null;
  if (guide) {
    const checks = parseChecks(task.guide_checks);
    const route = parseRoute(guide.body);
    if (route.hasNeeds) {
      // Each stop: [name (with note), all good?, [needs tapped]]
      out.route = route.stops.map((s) => [
        [s.name, s.note].filter(Boolean).join(' '),
        checks.good.includes(s.index) ? 1 : 0,
        s.needs.filter((n) => checks.followups.includes(n.index)).map((n) => n.label),
      ]);
    } else {
      const steps = parseChecklist(guide.body);
      if (steps.length) out.steps = steps.map((s) => [s.label, checks.steps.includes(s.step) ? 1 : 0, s.stop ? 1 : 0]);
    }
  }
  const stops = parseStops(task.followup_stops);
  if (stops.length) {
    const done = parseStops(task.followup_done);
    out.stops = stops.map((x) => [x, done.includes(x) ? 1 : 0]);
  }
  return Object.keys(out).length ? JSON.stringify(out) : null;
}

async function completeTask(env, user, id, { notes } = {}) {
  const task = await env.DB.prepare('SELECT * FROM tasks WHERE id = ?').bind(id).first();
  if (!task || !canSeeTask(user, task)) throw new HttpError(404, 'Task not found');
  if (task.status !== 'open') throw new HttpError(400, 'This task is already closed');
  const settings = await getSettings(env);
  const day = today(settings);
  const checklist = await checklistSnapshot(env, task);
  const stmts = [
    env.DB.prepare(
      // The owner's own work doesn't need reviewing: it's recorded as approved.
      `INSERT INTO completions (task_id, task_title, user_id, completed_at, completed_on, due_date, notes, checklist,
         review_status, reviewed_by, reviewed_at)
       VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?)`
    ).bind(id, task.title, user.id, nowIso(), day, task.due_date, str(notes, 5000), checklist,
      user.role === 'owner' ? 'approved' : 'pending', user.role === 'owner' ? user.id : null,
      user.role === 'owner' ? nowIso() : null),
  ];
  let next = null;
  let repeated = false;
  if (task.recur_type !== 'none') {
    next = nextDueAfterCompletion(task, day);
    stmts.push(env.DB.prepare('UPDATE tasks SET due_date = ?, guide_checks = NULL, updated_at = ? WHERE id = ?')
      .bind(next, nowIso(), id));
  } else if (task.repeat_on_complete) {
    // Straight back on the list, due anytime; its history stays on the task.
    repeated = true;
    stmts.push(env.DB.prepare('UPDATE tasks SET followup_done = NULL, guide_checks = NULL, updated_at = ? WHERE id = ?')
      .bind(nowIso(), id));
  } else {
    stmts.push(env.DB.prepare("UPDATE tasks SET status = 'done', updated_at = ? WHERE id = ?").bind(nowIso(), id));
  }
  await env.DB.batch(stmts);
  return { ok: true, next_due: next, repeated };
}

route('POST', '/api/tasks/:id/complete', async ({ env, user, params, body }) => {
  return json(await completeTask(env, user, Number(params.id), body));
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
    `SELECT c.*, u.name AS user_name, r.name AS reviewer_name, t.guide_id, t.property_id
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
const MAX_SHIFT_MS = AUTO_CLOCKOUT_HOURS * 3600000;

function logEdit(env, { entry, editor, kind, oldIn = null, oldOut = null, newIn = null, newOut = null, reason = '', workDate }) {
  return env.DB.prepare(
    `INSERT INTO time_edits (entry_id, entry_user_id, editor_id, kind, work_date, old_in, old_out, new_in, new_out, reason,
       entry_kind, needs_review)
     VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?,
       CASE WHEN ?12 IS NULL OR (SELECT role FROM users WHERE id = ?12) <> 'owner' THEN 1 ELSE 0 END)`
  ).bind(entry.id, entry.user_id, editor, kind, workDate || entry.work_date, oldIn, oldOut, newIn, newOut, reason,
    entry.kind || 'work', editor);
}

// Anyone still on the clock after 14 hours is clocked out automatically and
// asked to confirm or correct the time the next time they open the app.
async function autoClockOut(env) {
  const cutoff = new Date(Date.now() - MAX_SHIFT_MS).toISOString();
  const { results } = await env.DB.prepare(
    'SELECT * FROM time_entries WHERE clock_out IS NULL AND clock_in <= ?'
  ).bind(cutoff).all();
  if (!results.length) return 0;
  const stmts = [];
  for (const e of results) {
    const out = new Date(new Date(e.clock_in).getTime() + MAX_SHIFT_MS).toISOString();
    stmts.push(env.DB.prepare(
      'UPDATE time_entries SET clock_out = ?, auto_closed = 1, needs_review = 1 WHERE id = ? AND clock_out IS NULL'
    ).bind(out, e.id));
    stmts.push(logEdit(env, {
      entry: e, editor: null, kind: 'auto_clockout', newIn: e.clock_in, newOut: out,
      reason: `Still clocked in after ${AUTO_CLOCKOUT_HOURS} hours`,
    }));
  }
  await env.DB.batch(stmts);
  return results.length;
}

route('GET', '/api/time/status', async ({ env, user }) => {
  await autoClockOut(env);
  const settings = await getSettings(env);
  const day = today(settings);
  const period = payPeriodOf(day);
  const [open, { results }, { results: needsFix }] = await Promise.all([
    env.DB.prepare('SELECT * FROM time_entries WHERE user_id = ? AND clock_out IS NULL ORDER BY clock_in DESC LIMIT 1')
      .bind(user.id).first(),
    env.DB.prepare('SELECT * FROM time_entries WHERE user_id = ? AND work_date >= ? AND work_date <= ?')
      .bind(user.id, period.from, period.to).all(),
    env.DB.prepare('SELECT * FROM time_entries WHERE user_id = ? AND needs_review = 1 ORDER BY clock_in')
      .bind(user.id).all(),
  ]);
  const s = summarize(results.map((r) => ({ ...r, name: user.name })))[0];
  const editsToReview = user.role === 'owner'
    ? await env.DB.prepare('SELECT COUNT(*) AS n FROM time_edits WHERE needs_review = 1 AND reviewed_at IS NULL').first('n')
    : 0;
  return json({ open, todayHours: s?.days[day] || 0, periodHours: s?.total || 0, period, needsFix, editsToReview });
});

route('POST', '/api/time/clock-in', async ({ env, user, body }) => {
  await autoClockOut(env);
  const open = await env.DB.prepare('SELECT id FROM time_entries WHERE user_id = ? AND clock_out IS NULL').bind(user.id).first();
  if (open) throw new HttpError(400, 'You are already clocked in');
  const settings = await getSettings(env);
  const t = nowIso();
  await env.DB.prepare('INSERT INTO time_entries (user_id, clock_in, work_date, note) VALUES (?, ?, ?, ?)')
    .bind(user.id, t, localDate(t, settings.timezone), str(body.note, 500)).run();
  return json({ ok: true });
});

route('POST', '/api/time/clock-out', async ({ env, user, body }) => {
  await autoClockOut(env);
  const open = await env.DB.prepare(
    'SELECT * FROM time_entries WHERE user_id = ? AND clock_out IS NULL ORDER BY clock_in DESC LIMIT 1'
  ).bind(user.id).first();
  if (!open) throw new HttpError(400, 'You are not clocked in');
  const note = [open.note, str(body.note, 500)].filter(Boolean).join(' / ');
  await env.DB.prepare('UPDATE time_entries SET clock_out = ?, note = ? WHERE id = ?').bind(nowIso(), note, open.id).run();
  return json({ ok: true });
});

// Defaults to the current pay period.
function rangeParams(url, settings) {
  const period = payPeriodOf(today(settings));
  const from = optDate(url.searchParams.get('from')) || period.from;
  const to = optDate(url.searchParams.get('to')) || period.to;
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
  await autoClockOut(env);
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

function validateTimes(cin, cout) {
  if (!cin) throw new HttpError(400, 'Clock in time is required');
  const limit = Date.now() + 5 * 60000;
  if (new Date(cin) > limit || (cout && new Date(cout) > limit)) throw new HttpError(400, "Times can't be in the future");
  if (cout && cout <= cin) throw new HttpError(400, 'Clock out must be after clock in');
  if (cout && new Date(cout) - new Date(cin) > 24 * 3600000) throw new HttpError(400, "A single punch can't be longer than 24 hours");
}

// The app's time pickers only go to the minute; keep the original seconds
// when the minute didn't change so an untouched time isn't counted as edited.
const sameMinute = (a, b) => a && b && Math.floor(new Date(a) / 60000) === Math.floor(new Date(b) / 60000);

// Owners can add a punch for anyone; employees can add a missed punch for
// themselves. Every add is logged.
route('POST', '/api/time', async ({ env, user, body }) => {
  const isOwnerUser = user.role === 'owner';
  const settings = await getSettings(env);
  const uid = isOwnerUser ? optInt(body.user_id, 1, 1e9) : user.id;
  if (!uid) throw new HttpError(400, 'Pick an employee');
  const target = await env.DB.prepare('SELECT id FROM users WHERE id = ?').bind(uid).first();
  if (!target) throw new HttpError(400, 'Unknown employee');
  const reason = str(body.reason, 500);
  const cin = parseIso(body.clock_in, 'clock in');
  const cout = parseIso(body.clock_out, 'clock out');
  if (!cout) throw new HttpError(400, 'Clock out time is required');
  validateTimes(cin, cout);
  const workDate = localDate(cin, settings.timezone);
  const res = await env.DB.prepare(
    'INSERT INTO time_entries (user_id, clock_in, clock_out, work_date, note, edited, edited_by) VALUES (?, ?, ?, ?, ?, 1, ?)'
  ).bind(uid, cin, cout, workDate, reason, user.id).run();
  await logEdit(env, {
    entry: { id: res.meta.last_row_id, user_id: uid, work_date: workDate },
    editor: user.id, kind: 'add', newIn: cin, newOut: cout, reason,
  }).run();
  return json({ ok: true });
});

// Owners can change anyone's punch; employees can change their own. The
// before/after times and the reason are kept in time_edits for the owner.
route('PUT', '/api/time/:id', async ({ env, user, params, body }) => {
  const isOwnerUser = user.role === 'owner';
  const e = await env.DB.prepare('SELECT * FROM time_entries WHERE id = ?').bind(Number(params.id)).first();
  if (!e) throw new HttpError(404, 'Punch not found');
  if (!isOwnerUser && e.user_id !== user.id) throw new HttpError(403, 'You can only change your own time');
  if (e.kind === 'pto') {
    requireOwner(user);
    const { cin, cout, date } = ptoTimes(body);
    await env.DB.batch([
      env.DB.prepare('UPDATE time_entries SET clock_in = ?, clock_out = ?, work_date = ?, note = ?, edited = 1, edited_by = ? WHERE id = ?')
        .bind(cin, cout, date, str(body.reason, 500) || e.note, user.id, e.id),
      logEdit(env, { entry: e, editor: user.id, kind: 'edit', workDate: date, oldIn: e.clock_in, oldOut: e.clock_out,
        newIn: cin, newOut: cout, reason: str(body.reason, 500) }),
    ]);
    return json({ ok: true, changed: true });
  }
  const settings = await getSettings(env);
  let cin = parseIso(body.clock_in, 'clock in');
  let cout = parseIso(body.clock_out, 'clock out');
  if (sameMinute(cin, e.clock_in)) cin = e.clock_in;
  if (sameMinute(cout, e.clock_out)) cout = e.clock_out;
  validateTimes(cin, cout);
  const changed = cin !== e.clock_in || cout !== e.clock_out;
  const reason = str(body.reason, 500);
  if (!changed && !e.needs_review) return json({ ok: true, changed: false });
  if (changed && !isOwnerUser && !reason) throw new HttpError(400, 'Please say why you are changing this punch');
  const workDate = localDate(cin, settings.timezone);
  await env.DB.batch([
    env.DB.prepare(
      `UPDATE time_entries SET clock_in = ?, clock_out = ?, work_date = ?, needs_review = 0,
         edited = CASE WHEN ? THEN 1 ELSE edited END, edited_by = CASE WHEN ? THEN ? ELSE edited_by END WHERE id = ?`
    ).bind(cin, cout, workDate, changed ? 1 : 0, changed ? 1 : 0, user.id, e.id),
    logEdit(env, {
      entry: e, editor: user.id, kind: changed ? 'edit' : 'confirm', workDate,
      oldIn: e.clock_in, oldOut: e.clock_out, newIn: cin, newOut: cout,
      reason: reason || (changed ? '' : 'Confirmed the automatic clock-out time'),
    }),
  ]);
  return json({ ok: true, changed });
});

// PTO is stored as a block of hours on its date (starting at noon UTC so the
// date never shifts), which keeps the hour totals and payroll math simple.
function ptoTimes(body) {
  const date = optDate(body.date, 'Date');
  if (!date) throw new HttpError(400, 'Pick the PTO date');
  const hours = optNum(body.hours);
  if (hours == null || hours <= 0 || hours > 24) throw new HttpError(400, 'PTO hours must be between 0 and 24');
  const start = new Date(`${date}T12:00:00.000Z`);
  if (Math.abs(start - Date.now()) > 400 * 86400000) throw new HttpError(400, 'PTO date must be within a year of today');
  return { date, cin: start.toISOString(), cout: new Date(start.getTime() + Math.round(hours * 60) * 60000).toISOString() };
}

route('POST', '/api/time/pto', async ({ env, user, body }) => {
  requireOwner(user);
  const uid = optInt(body.user_id, 1, 1e9);
  const target = uid && await env.DB.prepare('SELECT id FROM users WHERE id = ?').bind(uid).first();
  if (!target) throw new HttpError(400, 'Pick an employee');
  const { cin, cout, date } = ptoTimes(body);
  const reason = str(body.reason, 500);
  const res = await env.DB.prepare(
    "INSERT INTO time_entries (user_id, clock_in, clock_out, work_date, note, kind, edited, edited_by) VALUES (?, ?, ?, ?, ?, 'pto', 0, ?)"
  ).bind(uid, cin, cout, date, reason, user.id).run();
  await logEdit(env, {
    entry: { id: res.meta.last_row_id, user_id: uid, work_date: date, kind: 'pto' },
    editor: user.id, kind: 'add', newIn: cin, newOut: cout, reason,
  }).run();
  return json({ ok: true });
});

route('DELETE', '/api/time/:id', async ({ env, user, params }) => {
  requireOwner(user);
  const e = await env.DB.prepare('SELECT * FROM time_entries WHERE id = ?').bind(Number(params.id)).first();
  if (!e) throw new HttpError(404, 'Punch not found');
  await env.DB.batch([
    env.DB.prepare('DELETE FROM time_entries WHERE id = ?').bind(e.id),
    logEdit(env, { entry: e, editor: user.id, kind: 'delete', oldIn: e.clock_in, oldOut: e.clock_out }),
  ]);
  return json({ ok: true });
});

// Change log for the time clock. Owners see everyone's; employees their own.
route('GET', '/api/time/edits', async ({ env, url, user }) => {
  const settings = await getSettings(env);
  const where = [];
  const args = [];
  const entryId = optInt(url.searchParams.get('entry_id'), 1, 1e12);
  if (entryId) {
    where.push('x.entry_id = ?');
    args.push(entryId);
  } else if (url.searchParams.get('unreviewed') === '1') {
    // Everything still waiting for the owner, whatever its date.
    where.push('x.needs_review = 1 AND x.reviewed_at IS NULL');
  } else {
    const { from, to } = rangeParams(url, settings);
    where.push('x.work_date >= ? AND x.work_date <= ?');
    args.push(from, to);
  }
  if (user.role !== 'owner') {
    where.push('x.entry_user_id = ?');
    args.push(user.id);
  }
  const { results } = await env.DB.prepare(
    `SELECT x.*, u.name AS employee_name, ed.name AS editor_name, rv.name AS reviewer_name FROM time_edits x
     JOIN users u ON u.id = x.entry_user_id LEFT JOIN users ed ON ed.id = x.editor_id
     LEFT JOIN users rv ON rv.id = x.reviewed_by
     WHERE ${where.join(' AND ')} ORDER BY x.created_at DESC LIMIT 500`
  ).bind(...args).all();
  return json(results);
});

// Owner marks a flagged time change as reviewed (or puts the flag back).
route('POST', '/api/time/edits/:id/review', async ({ env, user, params, body }) => {
  requireOwner(user);
  const reviewed = body.reviewed !== false;
  const res = await env.DB.prepare(
    'UPDATE time_edits SET reviewed_at = ?, reviewed_by = ? WHERE id = ? AND needs_review = 1'
  ).bind(reviewed ? nowIso() : null, reviewed ? user.id : null, Number(params.id)).run();
  if (!res.meta.changes) throw new HttpError(404, 'Change not found');
  return json({ ok: true });
});

route('POST', '/api/time/edits/review-all', async ({ env, user }) => {
  requireOwner(user);
  const res = await env.DB.prepare(
    'UPDATE time_edits SET reviewed_at = ?, reviewed_by = ? WHERE needs_review = 1 AND reviewed_at IS NULL'
  ).bind(nowIso(), user.id).run();
  return json({ reviewed: res.meta.changes });
});

// ===== Payroll (semi-monthly: 1st–15th and 16th–end of month) =====
async function payrollData(env, from, to) {
  await autoClockOut(env);
  const settings = await getSettings(env);
  const entries = await timeEntries(env, from, to, null);
  return { settings, entries, summary: summarize(entries) };
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
  const lines = summary.map((s) => `${s.name}: ${s.total.toFixed(2)} hrs` + (s.pto ? ` (${s.worked.toFixed(2)} worked + ${s.pto.toFixed(2)} PTO)` : '') +
    (s.edited || s.auto ? ` (${[s.edited && `${s.edited} changed by hand`, s.auto && `${s.auto} auto clock-out`].filter(Boolean).join(', ')})` : ''));
  const raw = buildPayrollEmail({
    from: env.PAYROLL_FROM,
    to: settings.payroll_email,
    subject: `${settings.ranch_name} payroll ${from} to ${to}`,
    text: `Hours for the pay period ${from} through ${to}:\n\n${lines.join('\n') || 'No hours recorded.'}\n\nDetailed timesheet attached (CSV).`,
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
  await autoClockOut(env);
  const settings = await getSettings(env);
  const { from, to } = rangeParams(url, settings);
  const onlyMe = user.role !== 'owner';
  const { results: users } = await env.DB.prepare(
    `SELECT id, name, role FROM users WHERE active = 1 ${onlyMe ? 'AND id = ?' : ''} ORDER BY name`
  ).bind(...(onlyMe ? [user.id] : [])).all();
  const { results: comp } = await env.DB.prepare(
    `SELECT user_id, COUNT(*) AS completed,
       SUM(CASE WHEN due_date IS NULL OR completed_on <= due_date THEN 1 ELSE 0 END) AS on_time,
       SUM(review_status = 'approved') AS approved, SUM(review_status = 'flagged') AS flagged,
       SUM(review_status = 'pending') AS pending
     FROM completions WHERE completed_on >= ? AND completed_on <= ? GROUP BY user_id`
  ).bind(from, to).all();
  const hours = summarize(await timeEntries(env, from, to, onlyMe ? user.id : null));
  const rows = users.map((u) => {
    const c = comp.find((x) => x.user_id === u.id) || {};
    const h = hours.find((x) => x.user_id === u.id);
    const days = h ? Object.keys(h.days).length : 0;
    return {
      user_id: u.id,
      name: u.name,
      role: u.role,
      hours: h ? h.worked : 0,
      pto: h ? h.pto : 0,
      days_worked: days,
      completed: c.completed || 0,
      on_time: c.on_time || 0,
      approved: c.approved || 0,
      flagged: c.flagged || 0,
      pending: c.pending || 0,
      tasks_per_day: days ? (c.completed || 0) / days : 0,
      time_changes: h ? h.edited : 0,
      auto_clockouts: h ? h.auto : 0,
    };
  });
  return json({ from, to, rows });
});

// ===== Properties & aerial photos =====
const MAX_PHOTO_BYTES = 1900000; // D1 rows top out at 2 MB; the app shrinks photos below this
const PHOTO_TYPES = ['image/jpeg', 'image/png', 'image/webp'];
const propertyCols = (user) => `p.id, p.name, p.notes, p.photo_type IS NOT NULL AS has_photo, p.photo_width, p.photo_height,
  p.photo_updated_at, (SELECT COUNT(*) FROM tasks t WHERE t.property_id = p.id AND t.status = 'open'${visibleSql(user)}) AS open_tasks`;

route('GET', '/api/properties', async ({ env, user }) => {
  const { results } = await env.DB.prepare(`SELECT ${propertyCols(user)} FROM properties p ORDER BY p.name`).all();
  return json(results);
});

route('GET', '/api/properties/:id', async ({ env, params, user }) => {
  const p = await env.DB.prepare(`SELECT ${propertyCols(user)} FROM properties p WHERE p.id = ?`).bind(Number(params.id)).first();
  if (!p) throw new HttpError(404, 'Property not found');
  const { results: tasks } = await env.DB.prepare(
    `SELECT t.id, t.title, t.due_date, t.priority, t.marks, t.location_name, a.name AS assigned_name
     FROM tasks t LEFT JOIN users a ON a.id = t.assigned_to
     WHERE t.property_id = ? AND t.status = 'open'${visibleSql(user)} ORDER BY t.due_date IS NULL, t.due_date, t.title`
  ).bind(p.id).all();
  return json({ ...p, tasks });
});

async function propertyFields(env, body, id = null) {
  const name = str(body.name, 80, true, 'Property name');
  const dup = await env.DB.prepare('SELECT id FROM properties WHERE name = ? AND id IS NOT ?').bind(name, id).first();
  if (dup) throw new HttpError(400, 'A property with that name already exists');
  return { name, notes: str(body.notes, 2000) };
}

route('POST', '/api/properties', async ({ env, user, body }) => {
  requireOwner(user);
  const p = await propertyFields(env, body);
  const res = await env.DB.prepare('INSERT INTO properties (name, notes) VALUES (?, ?)').bind(p.name, p.notes).run();
  return json({ id: res.meta.last_row_id });
});

route('PUT', '/api/properties/:id', async ({ env, user, params, body }) => {
  requireOwner(user);
  const id = Number(params.id);
  const p = await propertyFields(env, body, id);
  const res = await env.DB.prepare('UPDATE properties SET name = ?, notes = ? WHERE id = ?').bind(p.name, p.notes, id).run();
  if (!res.meta.changes) throw new HttpError(404, 'Property not found');
  return json({ ok: true });
});

route('DELETE', '/api/properties/:id', async ({ env, user, params }) => {
  requireOwner(user);
  const id = Number(params.id);
  await env.DB.batch([
    env.DB.prepare('UPDATE tasks SET property_id = NULL, marks = NULL WHERE property_id = ?').bind(id),
    env.DB.prepare('DELETE FROM properties WHERE id = ?').bind(id),
  ]);
  return json({ ok: true });
});

route('PUT', '/api/properties/:id/photo', async ({ env, user, params, request, url }) => {
  requireOwner(user);
  const type = (request.headers.get('Content-Type') || '').split(';')[0].trim();
  if (!PHOTO_TYPES.includes(type)) throw new HttpError(400, 'Photo must be a JPEG, PNG or WebP image');
  const buf = await request.arrayBuffer();
  if (!buf.byteLength) throw new HttpError(400, 'No photo received');
  if (buf.byteLength > MAX_PHOTO_BYTES) throw new HttpError(413, 'That photo is too large even after shrinking it');
  const res = await env.DB.prepare(
    'UPDATE properties SET photo = ?, photo_type = ?, photo_width = ?, photo_height = ?, photo_updated_at = ? WHERE id = ?'
  ).bind(buf, type, optInt(url.searchParams.get('w'), 1, 100000), optInt(url.searchParams.get('h'), 1, 100000),
    nowIso(), Number(params.id)).run();
  if (!res.meta.changes) throw new HttpError(404, 'Property not found');
  return json({ ok: true });
}, { raw: true });

route('GET', '/api/properties/:id/photo', async ({ env, params }) => {
  const row = await env.DB.prepare('SELECT photo, photo_type FROM properties WHERE id = ?').bind(Number(params.id)).first();
  if (!row || !row.photo) throw new HttpError(404, 'No photo for this property');
  return new Response(new Uint8Array(row.photo), {
    headers: {
      'Content-Type': row.photo_type,
      // The app adds ?v=<upload time> to the URL, so a new upload gets a new URL.
      'Cache-Control': 'private, max-age=31536000, immutable',
    },
  });
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

  // Hourly cron: auto clock-out anyone past 14 hours, and on the 1st and 16th
  // at 8am ranch time email the pay period that just ended (if turned on).
  async scheduled(event, env) {
    await autoClockOut(env);
    const settings = await getSettings(env);
    if (settings.payroll_auto_email !== '1') return;
    const now = new Date(event.scheduledTime || Date.now()).toISOString();
    const tz = settings.timezone || 'America/Chicago';
    const day = localDate(now, tz);
    const dom = Number(day.slice(8));
    if ((dom === 1 || dom === 16) && localHour(now, tz) === 8) {
      const p = previousPayPeriod(day);
      try {
        await emailPayroll(env, p.from, p.to);
      } catch (err) {
        console.error('Payroll email failed', err);
      }
    }
  },
};
