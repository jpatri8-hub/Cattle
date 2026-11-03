import { esc, renderGuide } from './md.js';
import { describeRule, addDays, parseDate } from './recurrence.js';
import { payPeriodOf, previousPayPeriod } from './payperiod.js';

const $ = (sel, el = document) => el.querySelector(sel);
const $$ = (sel, el = document) => [...el.querySelectorAll(sel)];
const main = $('#main');

const S = { user: null, settings: {}, today: '', emailEnabled: false, users: [], clock: null };
const isOwner = () => S.user?.role === 'owner';

// ---------- storage (per-device conveniences only) ----------
const store = {
  get(k, d = null) { try { const v = localStorage.getItem(k); return v == null ? d : JSON.parse(v); } catch { return d; } },
  set(k, v) { try { localStorage.setItem(k, JSON.stringify(v)); } catch { /* ignore */ } },
};

// ---------- API ----------
async function api(method, path, body) {
  const opts = { method, credentials: 'same-origin', headers: {} };
  if (method !== 'GET') opts.headers['X-Ranch'] = '1';
  if (body !== undefined) {
    opts.headers['Content-Type'] = 'application/json';
    opts.body = JSON.stringify(body);
  }
  const res = await fetch('/api' + path, opts);
  let data = null;
  try { data = await res.json(); } catch { /* empty */ }
  if (res.status === 401 && !['/login', '/me/password'].includes(path)) {
    S.user = null;
    location.hash = '#/login';
    throw new Error('Please log in');
  }
  if (!res.ok) throw new Error(data?.error || `Error ${res.status}`);
  return data;
}

// ---------- UI helpers ----------
let toastTimer;
function toast(msg, error = false) {
  const t = $('#toast');
  t.textContent = msg;
  t.className = 'show' + (error ? ' error' : '');
  clearTimeout(toastTimer);
  toastTimer = setTimeout(() => (t.className = ''), error ? 4500 : 2500);
}

const modal = $('#modal');
function openModal(html) {
  $('#modalBody').innerHTML = html;
  if (!modal.open) modal.showModal();
  $$('[data-close]', modal).forEach((b) => b.addEventListener('click', closeModal));
  return modal;
}
function closeModal() { if (modal.open) modal.close(); }
modal.addEventListener('click', (e) => { if (e.target === modal) closeModal(); });

// Wrap an async handler so errors show as a toast and buttons can't double-submit.
function guard(fn) {
  return async (e) => {
    e?.preventDefault?.();
    const btn = e?.submitter || (e?.currentTarget instanceof HTMLButtonElement ? e.currentTarget : null);
    if (btn) btn.disabled = true;
    try { await fn(e); } catch (err) { toast(err.message, true); } finally { if (btn) btn.disabled = false; }
  };
}

function formData(form) {
  const o = {};
  for (const [k, v] of new FormData(form)) o[k] = v;
  return o;
}

const DOW = ['Sun', 'Mon', 'Tue', 'Wed', 'Thu', 'Fri', 'Sat'];
function fmtDay(d) {
  if (!d) return '';
  if (d === S.today) return 'Today';
  if (d === addDays(S.today, 1)) return 'Tomorrow';
  if (d === addDays(S.today, -1)) return 'Yesterday';
  const dt = parseDate(d);
  const opts = { weekday: 'short', month: 'short', day: 'numeric', timeZone: 'UTC' };
  if (d.slice(0, 4) !== S.today.slice(0, 4)) opts.year = 'numeric';
  return dt.toLocaleDateString(undefined, opts);
}
const fmtTime = (iso) => new Date(iso).toLocaleTimeString([], { hour: 'numeric', minute: '2-digit' });
const fmtDateTime = (iso) => new Date(iso).toLocaleString([], { month: 'short', day: 'numeric', hour: 'numeric', minute: '2-digit' });
const hrs = (h) => (Math.round(h * 100) / 100).toFixed(2);
function duration(ms) {
  const m = Math.max(0, Math.floor(ms / 60000));
  return `${Math.floor(m / 60)}h ${String(m % 60).padStart(2, '0')}m`;
}
function toLocalInput(iso) {
  if (!iso) return '';
  const d = new Date(iso);
  return new Date(d.getTime() - d.getTimezoneOffset() * 60000).toISOString().slice(0, 16);
}
const fromLocalInput = (v) => (v ? new Date(v).toISOString() : null);

function userOptions(selected, { blank = 'Anyone' } = {}) {
  return `<option value="">${esc(blank)}</option>` + S.users.filter((u) => u.active || u.id === selected)
    .map((u) => `<option value="${u.id}" ${u.id === selected ? 'selected' : ''}>${esc(u.name)}</option>`).join('');
}

async function loadUsers() { S.users = await api('GET', '/users'); }

// Date ranges for reports. Pay periods are the 1st–15th and 16th–end of month.
function ranges() {
  const cur = payPeriodOf(S.today);
  const prev = previousPayPeriod(S.today);
  return {
    period: { label: 'This pay period', from: cur.from, to: cur.to },
    last: { label: 'Last pay period', from: prev.from, to: prev.to },
    month: { label: 'This month', from: S.today.slice(0, 8) + '01', to: S.today },
    d30: { label: 'Last 30 days', from: addDays(S.today, -29), to: S.today },
  };
}
function rangeChips(active, attr = 'data-range') {
  return `<div class="chips">${Object.entries(ranges()).map(([k, r]) =>
    `<button class="chip ${k === active ? 'on' : ''}" ${attr}="${k}">${r.label}</button>`).join('')}</div>`;
}

// ---------- property photos ----------
const photoUrl = (p) => `/api/properties/${p.id}/photo?v=${encodeURIComponent(p.photo_updated_at || '')}`;
function pinClass(t) {
  if (!t.due_date) return 'anytime';
  if (t.due_date < S.today) return 'late';
  if (t.due_date === S.today) return 'today';
  return 'soon';
}
// pins: [{ x, y, label, cls, href, title }] with x/y as 0..1 fractions of the photo.
function photoWithPins(p, pins = [], id = '') {
  return `<div class="photo-wrap" ${id ? `id="${id}"` : ''}>
    <img src="${photoUrl(p)}" alt="Aerial photo of ${esc(p.name)}" draggable="false">
    ${pins.map((pin) => {
      const style = `left:${Number(pin.x) * 100}%;top:${Number(pin.y) * 100}%`;
      const attrs = `class="pin ${pin.cls || ''}" style="${style}" title="${esc(pin.title || '')}"`;
      return pin.href ? `<a ${attrs} href="${pin.href}">${esc(pin.label ?? '')}</a>` : `<span ${attrs}>${esc(pin.label ?? '')}</span>`;
    }).join('')}
  </div>`;
}

// Shrink an aerial photo in the browser so it fits in the database (< ~1.8 MB).
async function shrinkPhoto(file) {
  const bmp = await createImageBitmap(file);
  for (const maxSide of [2400, 2000, 1600, 1200]) {
    const scale = Math.min(1, maxSide / Math.max(bmp.width, bmp.height));
    const w = Math.round(bmp.width * scale);
    const h = Math.round(bmp.height * scale);
    const canvas = document.createElement('canvas');
    canvas.width = w;
    canvas.height = h;
    canvas.getContext('2d').drawImage(bmp, 0, 0, w, h);
    for (const q of [0.85, 0.75, 0.65]) {
      const blob = await new Promise((r) => canvas.toBlob(r, 'image/jpeg', q));
      if (blob && blob.size <= 1800000) return { blob, w, h };
    }
  }
  throw new Error('Could not shrink that photo enough. Try a smaller image.');
}
async function uploadPhoto(propertyId, file) {
  const { blob, w, h } = await shrinkPhoto(file);
  const res = await fetch(`/api/properties/${propertyId}/photo?w=${w}&h=${h}`, {
    method: 'PUT', credentials: 'same-origin', headers: { 'X-Ranch': '1', 'Content-Type': 'image/jpeg' }, body: blob,
  });
  if (!res.ok) throw new Error((await res.json().catch(() => null))?.error || 'Photo upload failed');
}

// ---------- clock ----------
let clockTick;
async function refreshClock() {
  try { S.clock = await api('GET', '/time/status'); } catch { return; }
  paintClock();
  askToFixAutoClockOut();
}
function paintClock() {
  const pill = $('#clockPill');
  const c = S.clock;
  if (!c) return;
  pill.hidden = false;
  pill.classList.toggle('on', Boolean(c.open));
  pill.textContent = c.open ? `On clock ${duration(Date.now() - new Date(c.open.clock_in))}` : 'Off clock';
  const card = $('#clockCard');
  if (card) card.innerHTML = clockCardInner();
  clearInterval(clockTick);
  if (c.open) clockTick = setInterval(() => {
    pill.textContent = `On clock ${duration(Date.now() - new Date(c.open.clock_in))}`;
    const tm = $('#clockTimer');
    if (tm) tm.textContent = duration(Date.now() - new Date(c.open.clock_in));
  }, 15000);
}
function clockCardInner() {
  const c = S.clock;
  if (!c) return '<div class="muted">Loading time clock…</div>';
  const period = `This pay period (${fmtDay(c.period.from)} – ${fmtDay(c.period.to)}): ${hrs(c.periodHours)} hrs`;
  if (c.open) {
    return `<div class="status">Clocked in since <b>${fmtTime(c.open.clock_in)}</b></div>
      <div class="timer" id="clockTimer">${duration(Date.now() - new Date(c.open.clock_in))}</div>
      <div class="muted small" style="margin-bottom:10px">${period}</div>
      <button class="big danger" data-clock="out">Clock out</button>`;
  }
  return `<div class="status">You're <b>off the clock</b></div>
    <div class="muted small" style="margin-bottom:10px">Today: ${hrs(c.todayHours)} hrs · ${period}</div>
    <button class="big ok" data-clock="in">Clock in</button>`;
}

// After a 14-hour auto clock-out, ask the employee for their real clock-out time.
let fixOpen = false;
function askToFixAutoClockOut() {
  const e = S.clock?.needsFix?.[0];
  if (!e || fixOpen || modal.open) return;
  fixOpen = true;
  openModal(`<h2>Please fix your clock-out</h2>
    <p>You were still clocked in after <b>14 hours</b>, so you were clocked out automatically.</p>
    <p class="card" style="background:var(--bg)"><b>${fmtDay(e.work_date)}</b><br>Clocked in ${fmtDateTime(e.clock_in)}<br>
      Auto clocked out ${fmtDateTime(e.clock_out)}</p>
    <form id="fixForm">
      <div class="field"><label>What time did you actually stop working?</label>
        <input type="datetime-local" name="clock_out" required value="${toLocalInput(e.clock_out)}"></div>
      <div class="field"><label>Note</label><input name="reason" maxlength="500" value="Forgot to clock out"></div>
      <button class="primary big" type="submit">Save</button>
      <p class="muted small">If the time above is right, just tap Save. The owner can see this change.</p>
    </form>`);
  modal.addEventListener('close', () => { fixOpen = false; }, { once: true });
  $('#fixForm').addEventListener('submit', guard(async (ev) => {
    const d = formData(ev.target);
    await api('PUT', `/time/${e.id}`, { clock_in: e.clock_in, clock_out: fromLocalInput(d.clock_out), reason: d.reason });
    closeModal();
    toast('Thanks, your time is fixed.');
    await refreshClock();
    if (location.hash.startsWith('#/time')) render();
  }));
}

document.addEventListener('click', async (e) => {
  const b = e.target.closest('[data-clock]');
  if (!b || b.disabled) return;
  if (b.dataset.clock === 'out' && !confirm('Clock out now?')) return;
  b.disabled = true;
  try {
    if (b.dataset.clock === 'in') {
      await api('POST', '/time/clock-in', {});
      toast('Clocked in. Have a good one!');
    } else {
      await api('POST', '/time/clock-out', {});
      toast('Clocked out.');
    }
    await refreshClock();
    if (location.hash.startsWith('#/time')) render();
  } catch (err) {
    toast(err.message, true);
    b.disabled = false;
  }
});

// ---------- review badge ----------
async function refreshBadge() {
  const b = $('#reviewBadge');
  if (!isOwner()) { b.hidden = true; return; }
  try {
    const pending = await api('GET', '/completions?review=pending');
    b.hidden = pending.length === 0;
    b.textContent = pending.length > 99 ? '99+' : pending.length;
  } catch { /* ignore */ }
}

// ---------- complete task ----------
function completeTask(task, after) {
  openModal(`<h2>Mark done: ${esc(task.title)}</h2>
    <form id="doneForm" class="stack">
      <div class="field"><label for="dn">Notes for the owner (optional)</label>
        <textarea id="dn" name="notes" placeholder="Anything to report? Broken water float, low on mineral, etc."></textarea></div>
      <div class="row"><button class="primary grow" type="submit">✓ Mark complete</button><button type="button" data-close>Cancel</button></div>
    </form>`);
  $('#doneForm').addEventListener('submit', guard(async (e) => {
    const r = await api('POST', `/tasks/${task.id}/complete`, formData(e.target));
    closeModal();
    toast(r.next_due ? `Done! Next due ${fmtDay(r.next_due)}` : 'Done!');
    refreshBadge();
    after?.();
  }));
}

// ===================== VIEWS =====================

function viewSetup() {
  $('#topbar').hidden = $('#tabs').hidden = true;
  const tz = Intl.DateTimeFormat().resolvedOptions().timeZone || 'America/Chicago';
  main.innerHTML = `<div class="auth card">
    <h1>Welcome — let's set up</h1>
    <p class="muted">Create the <b>owner</b> account. You'll add your hands after this.</p>
    <form id="setupForm">
      <div class="field"><label>Ranch name</label><input name="ranch_name" required placeholder="Patrick's Cattle Ranch"></div>
      <div class="field"><label>Your name</label><input name="name" required autocomplete="name"></div>
      <div class="field"><label>Username</label><input name="username" required autocapitalize="none" autocomplete="username"></div>
      <div class="field"><label>Password (6+ characters)</label><input name="password" type="password" minlength="6" required autocomplete="new-password"></div>
      <input type="hidden" name="timezone" value="${esc(tz)}">
      <p class="muted small">Time zone: ${esc(tz)} (change later in Settings)</p>
      <button class="primary big" type="submit">Create owner account</button>
    </form></div>`;
  $('#setupForm').addEventListener('submit', guard(async (e) => {
    await api('POST', '/setup', formData(e.target));
    await boot();
  }));
}

function viewLogin() {
  $('#topbar').hidden = $('#tabs').hidden = true;
  main.innerHTML = `<div class="auth card">
    <h1>${esc(S.settings.ranch_name || 'Ranch Tasks')}</h1>
    <form id="loginForm">
      <div class="field"><label>Username</label><input name="username" required autocapitalize="none" autocomplete="username"></div>
      <div class="field"><label>Password or PIN</label><input name="password" type="password" required autocomplete="current-password"></div>
      <button class="primary big" type="submit">Log in</button>
    </form></div>`;
  $('#loginForm').addEventListener('submit', guard(async (e) => {
    await api('POST', '/login', formData(e.target));
    await boot();
  }));
}

// ----- Tasks (home) -----
function taskRow(t) {
  const late = t.due_date && t.due_date < S.today;
  const meta = [];
  if (t.due_date) meta.push(`<span class="${late ? 'tag late' : ''}">${late ? 'Due ' : ''}${fmtDay(t.due_date)}</span>`);
  if (t.recur_type !== 'none') meta.push(`<span>↻ ${esc(describeRule(t))}</span>`);
  meta.push(`<span>👤 ${esc(t.assigned_name || 'Anyone')}</span>`);
  if (t.priority === 'high') meta.push('<span class="tag high">High</span>');
  if (t.guide_id) meta.push('<span title="Has instructions">📘 Guide</span>');
  if (t.property_name || t.location_name) {
    meta.push(`<span>📍 ${esc([t.property_name, t.location_name].filter(Boolean).join(' · '))}</span>`);
  }
  if (t.est_minutes) meta.push(`<span>~${t.est_minutes} min</span>`);
  return `<div class="task">
    <button class="done-btn" data-done="${t.id}" aria-label="Mark ${esc(t.title)} done" title="Mark done">✓</button>
    <div class="grow"><a class="title" href="#/task/${t.id}">${esc(t.title)}</a><div class="meta">${meta.join('')}</div></div>
  </div>`;
}

async function viewTasks() {
  const filter = store.get('taskFilter', isOwner() ? 'all' : 'mine');
  const [tasks, doneToday] = await Promise.all([
    api('GET', '/tasks'),
    api('GET', `/completions?from=${S.today}&to=${S.today}`),
  ]);
  const shown = tasks.filter((t) => filter === 'all' || !t.assigned_to || t.assigned_to === S.user.id);
  const week = addDays(S.today, 7);
  const groups = [
    ['Overdue', shown.filter((t) => t.due_date && t.due_date < S.today), 'late'],
    ['Today', shown.filter((t) => t.due_date === S.today)],
    ['Next 7 days', shown.filter((t) => t.due_date > S.today && t.due_date <= week)],
    ['Anytime', shown.filter((t) => !t.due_date)],
    ['Later', shown.filter((t) => t.due_date > week)],
  ];
  const collapsedLater = store.get('showLater', false);
  main.innerHTML = `
    <div class="card clock-card" id="clockCard">${clockCardInner()}</div>
    <div class="row between">
      <div class="chips" style="margin:0">
        <button class="chip ${filter === 'mine' ? 'on' : ''}" data-filter="mine">Mine + unassigned</button>
        <button class="chip ${filter === 'all' ? 'on' : ''}" data-filter="all">Everyone</button>
      </div>
      <a class="btn primary" href="#/task/new">+ New task</a>
    </div>
    ${groups.map(([title, list, cls]) => {
      if (!list.length) return '';
      const isLater = title === 'Later';
      return `<div class="section-title ${cls || ''}"><h2>${title}</h2><span class="muted small">${list.length}</span></div>
        ${isLater && !collapsedLater ? `<button class="link" id="showLater">Show ${list.length} later task(s)</button>` : list.map(taskRow).join('')}`;
    }).join('')}
    ${shown.length ? '' : '<div class="empty card">No open tasks. Tap <b>+ New task</b> to add one.</div>'}
    ${doneToday.length ? `<div class="section-title"><h2>Done today</h2><span class="muted small">${doneToday.length}</span></div>
      <div class="card">${doneToday.map((c) => `<div class="row between small" style="padding:4px 0">
        <a href="#/task/${c.task_id}">✓ ${esc(c.task_title)}</a><span class="muted">${esc(c.user_name)} · ${fmtTime(c.completed_at)}</span></div>`).join('')}</div>` : ''}`;
  $$('[data-filter]').forEach((b) => b.addEventListener('click', () => { store.set('taskFilter', b.dataset.filter); render(); }));
  $('#showLater')?.addEventListener('click', () => { store.set('showLater', true); render(); });
  $$('[data-done]').forEach((b) => b.addEventListener('click', () => {
    completeTask(tasks.find((t) => t.id === Number(b.dataset.done)), render);
  }));
}

async function viewTask(id) {
  const t = await api('GET', `/tasks/${id}`);
  const canEdit = isOwner() || t.created_by === S.user.id;
  const late = t.due_date && t.due_date < S.today;
  const chkKey = `chk:${t.id}:${t.due_date || 'any'}`;
  const prop = t.property_id ? { id: t.property_id, name: t.property_name, photo_updated_at: t.property_photo_at } : null;
  main.innerHTML = `
    <p><a href="#/">← Tasks</a></p>
    <div class="card">
      <div class="row between"><h1 class="grow">${esc(t.title)}</h1>
        ${t.status !== 'open' ? `<span class="tag">${esc(t.status)}</span>` : ''}</div>
      <div class="meta row small muted" style="gap:10px">
        ${t.due_date ? `<span class="${late ? 'tag late' : ''}">Due ${fmtDay(t.due_date)}</span>` : '<span>Anytime</span>'}
        <span>↻ ${esc(describeRule(t))}</span>
        <span>👤 ${esc(t.assigned_name || 'Anyone')}</span>
        ${t.priority === 'high' ? '<span class="tag high">High priority</span>' : ''}
        ${t.est_minutes ? `<span>~${t.est_minutes} min</span>` : ''}
      </div>
      ${t.description ? `<p class="desc">${esc(t.description)}</p>` : ''}
      ${t.status === 'open' ? '<button class="primary big" id="doneBtn" style="margin-top:8px">✓ Mark complete</button>' : ''}
    </div>
    ${prop || t.location_name ? `<div class="card"><div class="row between"><h2 style="margin:0">📍 ${esc(prop ? prop.name : t.location_name)}</h2>
        ${prop ? `<a class="small" href="#/property/${prop.id}">Property</a>` : ''}</div>
        ${prop && t.location_name ? `<p class="muted small" style="margin:4px 0 0">${esc(t.location_name)}</p>` : ''}
        ${prop && t.property_has_photo ? `<div style="margin-top:8px">${photoWithPins(prop, t.pin_x != null ? [{ x: t.pin_x, y: t.pin_y, cls: 'mark' }] : [])}</div>
          <p class="small" style="margin-bottom:0"><a href="${photoUrl(prop)}" target="_blank" rel="noopener">Open full-size photo</a> (pinch to zoom)</p>` : ''}
      </div>` : ''}
    ${t.guide ? `<div class="card"><div class="row between"><h2 style="margin:0">📘 ${esc(t.guide.title)}</h2>
        <a href="#/guide/${t.guide.id}" class="small">Open guide</a></div>
        <p class="muted small">Tick off steps as you go.</p>
        <div class="guide-body" id="guideBody">${renderGuide(t.guide.body, { checklist: true })}</div></div>` : ''}
    <div class="card"><h2 style="margin-top:0">History</h2>
      ${t.history.length ? t.history.map((c) => `<div style="padding:6px 0;border-bottom:1px solid var(--line)">
        <div class="row between"><b>${esc(c.user_name)}</b><span class="tag ${c.review_status}">${c.review_status}</span></div>
        <div class="small muted">${fmtDateTime(c.completed_at)}${c.due_date && c.completed_on > c.due_date ? ' · <span class="tag late">late</span>' : ''}</div>
        ${c.notes ? `<div class="small desc">${esc(c.notes)}</div>` : ''}
        ${c.review_note ? `<div class="small"><b>${esc(c.reviewer_name || 'Owner')}:</b> ${esc(c.review_note)}</div>` : ''}
      </div>`).join('') : '<p class="muted">Not completed yet.</p>'}
    </div>
    <p class="muted small">Created by ${esc(t.created_by_name || '—')}</p>
    <div class="row">
      ${canEdit ? `<a class="btn" href="#/task/${t.id}/edit">Edit</a>` : ''}
      <a class="btn" href="#/task/new?copy=${t.id}">Duplicate</a>
      ${canEdit && t.status === 'open' ? '<button class="danger" id="archiveBtn">Archive</button>' : ''}
      ${canEdit && t.status !== 'open' ? '<button id="reopenBtn">Reopen</button>' : ''}
    </div>`;
  $('#doneBtn')?.addEventListener('click', () => completeTask(t, render));
  const checked = new Set(store.get(chkKey, []));
  $$('#guideBody input[type=checkbox]').forEach((cb) => {
    cb.checked = checked.has(cb.dataset.step);
    cb.addEventListener('change', () => {
      cb.checked ? checked.add(cb.dataset.step) : checked.delete(cb.dataset.step);
      store.set(chkKey, [...checked]);
    });
  });
  $('#archiveBtn')?.addEventListener('click', guard(async () => {
    if (!confirm('Archive this task? Its history is kept.')) return;
    await api('DELETE', `/tasks/${t.id}`);
    toast('Archived');
    location.hash = '#/';
  }));
  $('#reopenBtn')?.addEventListener('click', guard(async () => {
    await api('PUT', `/tasks/${t.id}`, { ...t, status: 'open' });
    toast('Reopened');
    render();
  }));
}

// Repeat presets → (type, interval, weekdays)
const PRESETS = {
  none: ['none', 1, ''],
  daily: ['daily', 1, ''],
  weekdays: ['weekly', 1, '1,2,3,4,5'],
  weekly: ['weekly', 1, ''],
  biweekly: ['weekly', 2, ''],
  monthly: ['monthly', 1, ''],
  quarterly: ['monthly', 3, ''],
  twice: ['monthly', 6, ''],
  yearly: ['yearly', 1, ''],
};
function presetFor(t) {
  for (const [k, [type, n, wd]] of Object.entries(PRESETS)) {
    if (t.recur_type === type && (t.recur_interval || 1) === n && (t.recur_weekdays || '') === wd) return k;
  }
  return t.recur_type === 'none' ? 'none' : 'custom';
}

async function viewTaskForm(id, query) {
  const [guides, properties] = await Promise.all([api('GET', '/guides'), api('GET', '/properties'), loadUsers()]);
  let t = { title: '', description: '', priority: 'normal', recur_type: 'none', recur_interval: 1, recur_weekdays: '', due_date: S.today };
  if (id) t = await api('GET', `/tasks/${id}`);
  else if (query.get('copy')) {
    const src = await api('GET', `/tasks/${query.get('copy')}`);
    t = { ...src, title: src.title + ' (copy)', due_date: S.today };
  }
  if (query.get('guide')) t.guide_id = Number(query.get('guide'));
  if (query.get('property')) t.property_id = Number(query.get('property'));
  const preset = presetFor(t);
  const wd = new Set((t.recur_weekdays || '').split(',').filter(Boolean));
  main.innerHTML = `
    <p><a href="${id ? `#/task/${id}` : '#/'}">← Back</a></p>
    <h1>${id ? 'Edit task' : 'New task'}</h1>
    <form id="taskForm" class="card">
      <div class="field"><label>What needs doing?</label><input name="title" required maxlength="160" value="${esc(t.title)}" placeholder="Bush hog north pasture"></div>
      <div class="field"><label>Details</label><textarea name="description" placeholder="Anything specific about this job">${esc(t.description)}</textarea></div>
      <div class="field"><label>Instructions (guide)</label>
        <div class="row"><select name="guide_id" class="grow" style="flex:1">
          <option value="">— none —</option>
          ${guides.map((g) => `<option value="${g.id}" ${g.id === t.guide_id ? 'selected' : ''}>${esc(g.category)}: ${esc(g.title)}</option>`).join('')}
        </select><a class="btn" href="#/guide/new">+ New guide</a></div>
        <p class="muted small">Reusable how-to notes (hookup steps, safety). Write once, attach to any task.</p></div>
      <div class="grid2">
        <div class="field"><label>Assigned to</label><select name="assigned_to">${userOptions(t.assigned_to)}</select></div>
        <div class="field"><label>Priority</label><select name="priority">
          ${['low', 'normal', 'high'].map((p) => `<option ${p === t.priority ? 'selected' : ''}>${p}</option>`).join('')}</select></div>
      </div>
      <div class="grid2">
        <div class="field"><label>Repeats</label><select name="preset" id="preset">
          <option value="none">One time</option><option value="daily">Every day</option><option value="weekdays">Weekdays (Mon–Fri)</option>
          <option value="weekly">Every week</option><option value="biweekly">Every 2 weeks</option><option value="monthly">Every month</option>
          <option value="quarterly">Quarterly</option><option value="twice">Twice a year</option><option value="yearly">Once a year</option>
          <option value="custom">Custom…</option></select></div>
        <div class="field"><label id="dueLabel">Due date</label><input type="date" name="due_date" value="${esc(t.due_date || '')}"></div>
      </div>
      <div id="custom" class="card" style="background:var(--bg)">
        <div class="grid2">
          <div class="field"><label>Every</label><input type="number" name="recur_interval" min="1" max="52" value="${t.recur_interval || 1}"></div>
          <div class="field"><label>Unit</label><select name="recur_type">
            ${['daily', 'weekly', 'monthly', 'yearly'].map((u) => `<option value="${u}" ${u === t.recur_type ? 'selected' : ''}>${{ daily: 'day(s)', weekly: 'week(s)', monthly: 'month(s)', yearly: 'year(s)' }[u]}</option>`).join('')}
          </select></div>
        </div>
        <div class="field" id="wdField"><label>On these days</label><div class="weekdays">
          ${DOW.map((d, i) => `<label><input type="checkbox" name="wd" value="${i}" ${wd.has(String(i)) ? 'checked' : ''}>${d}</label>`).join('')}
        </div></div>
      </div>
      <p class="muted small" id="recurHelp"></p>
      <div class="field"><label>Estimated time (minutes)</label><input type="number" name="est_minutes" min="0" inputmode="numeric" value="${esc(t.est_minutes ?? '')}"></div>
      <div class="field"><label>Property</label><select name="property_id" id="propSel">
        <option value="">— none —</option>
        ${properties.map((p) => `<option value="${p.id}" ${p.id === t.property_id ? 'selected' : ''}>${esc(p.name)}</option>`).join('')}
      </select>
      ${properties.length ? '' : `<p class="muted small">${isOwner() ? 'Add properties and their aerial photos under the <a href="#/properties">Properties</a> tab.' : 'No properties have been added yet.'}</p>`}</div>
      <div class="field"><label>Spot (optional)</label><input name="location_name" maxlength="120" value="${esc(t.location_name || '')}" placeholder="North pasture gate"></div>
      <input type="hidden" name="pin_x" value="${esc(t.pin_x ?? '')}"><input type="hidden" name="pin_y" value="${esc(t.pin_y ?? '')}">
      <div id="pinArea" class="field"></div>
      <button class="primary big" type="submit">${id ? 'Save changes' : 'Create task'}</button>
    </form>`;
  const form = $('#taskForm');
  $('#preset').value = preset;
  const syncRecur = () => {
    const p = $('#preset').value;
    $('#custom').classList.toggle('hidden', p !== 'custom');
    $('#wdField').classList.toggle('hidden', form.recur_type.value !== 'weekly');
    $('#dueLabel').textContent = p === 'none' ? 'Due date (blank = anytime)' : 'Starts on';
    $('#recurHelp').textContent = p === 'none' ? '' : 'When marked complete, the task moves itself to the next due date.';
  };
  $('#preset').addEventListener('change', syncRecur);
  form.recur_type.addEventListener('change', syncRecur);
  syncRecur();

  // Property photo: tap to mark where the job is.
  const paintPin = () => {
    const p = properties.find((x) => x.id === Number(form.property_id.value));
    const area = $('#pinArea');
    if (!p) { area.innerHTML = ''; return; }
    if (!p.has_photo) { area.innerHTML = '<p class="muted small">This property has no aerial photo yet.</p>'; return; }
    const pin = form.pin_x.value !== '' ? [{ x: form.pin_x.value, y: form.pin_y.value, cls: 'mark' }] : [];
    area.innerHTML = `<label>Mark the spot on the photo (optional)</label>
      <p class="muted small" style="margin-top:0">Tap the photo where the job is.</p>
      ${photoWithPins(p, pin, 'pinPhoto')}
      ${pin.length ? '<button type="button" class="link" id="clearPin">Remove mark</button>' : ''}`;
    $('#pinPhoto').addEventListener('click', (e) => {
      const r = $('#pinPhoto img').getBoundingClientRect();
      const x = (e.clientX - r.left) / r.width;
      const y = (e.clientY - r.top) / r.height;
      if (x < 0 || x > 1 || y < 0 || y > 1) return;
      form.pin_x.value = x.toFixed(4);
      form.pin_y.value = y.toFixed(4);
      paintPin();
    });
    $('#clearPin')?.addEventListener('click', () => { form.pin_x.value = form.pin_y.value = ''; paintPin(); });
  };
  form.property_id.addEventListener('change', () => { form.pin_x.value = form.pin_y.value = ''; paintPin(); });
  paintPin();

  form.addEventListener('submit', guard(async (e) => {
    const d = formData(form);
    const p = d.preset;
    if (p !== 'custom') {
      [d.recur_type, d.recur_interval, d.recur_weekdays] = PRESETS[p];
    } else {
      d.recur_weekdays = $$('input[name=wd]:checked', form).map((x) => x.value).join(',');
    }
    const res = id ? await api('PUT', `/tasks/${id}`, d) : await api('POST', '/tasks', d);
    toast(id ? 'Saved' : 'Task created');
    location.hash = `#/task/${id || res.id}`;
  }));
}

async function viewClosed() {
  const [done, archived] = await Promise.all([api('GET', '/tasks?status=done'), api('GET', '/tasks?status=archived')]);
  const list = (arr) => arr.length ? arr.map((t) => `<a class="list-link" href="#/task/${t.id}"><div class="card">
      <b>${esc(t.title)}</b><div class="small muted">${t.last_completed_at ? 'Last done ' + fmtDateTime(t.last_completed_at) : 'Never completed'}</div></div></a>`).join('')
    : '<p class="muted">None.</p>';
  main.innerHTML = `<p><a href="#/more">← More</a></p><h1>Finished &amp; archived tasks</h1>
    <h2>Completed one-time tasks</h2>${list(done)}<h2>Archived</h2>${list(archived)}`;
}

// ----- Guides -----
const GUIDE_CATS = ['Equipment', 'Livestock', 'Fencing', 'Maintenance', 'Feeding', 'Safety', 'Other'];

async function viewGuides() {
  const guides = await api('GET', '/guides');
  main.innerHTML = `<div class="row between"><h1>How-to guides</h1><a class="btn primary" href="#/guide/new">+ New guide</a></div>
    <p class="muted">Hookup steps, operating tips and safety notes. Attach a guide to any task so it shows up every time.</p>
    <input id="q" type="search" placeholder="Search guides…" style="margin-bottom:12px">
    <div id="glist"></div>`;
  const paint = () => {
    const q = $('#q').value.toLowerCase();
    const list = guides.filter((g) => !q || (g.title + ' ' + g.category + ' ' + g.preview).toLowerCase().includes(q));
    let cat = null;
    $('#glist').innerHTML = list.map((g) => {
      const head = g.category !== cat ? `<h2>${esc((cat = g.category))}</h2>` : '';
      return head + `<a class="list-link" href="#/guide/${g.id}"><div class="card"><b>${esc(g.title)}</b>
        <div class="small muted">${esc(g.preview.replace(/[#*!\-\[\]]/g, '').slice(0, 120))}…</div>
        ${g.task_count ? `<div class="small">Used by ${g.task_count} open task(s)</div>` : ''}</div></a>`;
    }).join('') || '<div class="empty card">No guides yet.</div>';
  };
  $('#q').addEventListener('input', paint);
  paint();
}

async function viewGuide(id) {
  const g = await api('GET', `/guides/${id}`);
  main.innerHTML = `<p><a href="#/guides">← Guides</a></p>
    <div class="card"><span class="tag">${esc(g.category)}</span><h1 style="margin-top:6px">${esc(g.title)}</h1>
      <div class="guide-body" id="gb">${renderGuide(g.body, { checklist: true })}</div>
      <p class="muted small">Last updated ${fmtDateTime(g.updated_at)}${g.updated_by_name ? ' by ' + esc(g.updated_by_name) : ''}</p></div>
    ${g.tasks.length ? `<div class="card"><h2 style="margin-top:0">Open tasks using this guide</h2>
      ${g.tasks.map((t) => `<div><a href="#/task/${t.id}">${esc(t.title)}</a> <span class="muted small">${t.due_date ? fmtDay(t.due_date) : ''}</span></div>`).join('')}</div>` : ''}
    <div class="row"><a class="btn" href="#/guide/${g.id}/edit">Edit</a>
      <a class="btn" href="#/task/new?guide=${g.id}">+ Task with this guide</a>
      ${isOwner() ? '<button class="danger" id="delGuide">Delete</button>' : ''}</div>`;
  $('#delGuide')?.addEventListener('click', guard(async () => {
    if (!confirm('Delete this guide? Tasks using it will keep working, just without instructions.')) return;
    await api('DELETE', `/guides/${g.id}`);
    location.hash = '#/guides';
  }));
}

async function viewGuideForm(id) {
  const g = id ? await api('GET', `/guides/${id}`) : { title: '', category: 'Equipment', body: '' };
  main.innerHTML = `<p><a href="${id ? `#/guide/${id}` : '#/guides'}">← Back</a></p>
    <h1>${id ? 'Edit guide' : 'New guide'}</h1>
    <form id="gForm" class="card">
      <div class="field"><label>Title</label><input name="title" required maxlength="120" value="${esc(g.title)}" placeholder="Bush hog — hookup & operation"></div>
      <div class="field"><label>Category</label><input name="category" list="cats" value="${esc(g.category)}">
        <datalist id="cats">${GUIDE_CATS.map((c) => `<option value="${c}">`).join('')}</datalist></div>
      <div class="field"><label>Instructions</label>
        <textarea name="body" style="min-height:320px;font-family:ui-monospace,monospace;font-size:.92rem" placeholder="## Hookup&#10;1. Back up square to the cutter&#10;2. Attach left lower arm first&#10;! Engine off before touching the PTO shaft">${esc(g.body)}</textarea>
        <details class="small muted"><summary>Formatting help</summary>
          <p><code>## Heading</code> · <code>1. Numbered step</code> · <code>- Bullet</code> · <code>**bold**</code> ·
          <code>! Safety warning</code> (shows as a yellow callout) · <code>[link](https://…)</code>.
          Steps and bullets become tick-boxes when a hand opens the guide from a task.</p></details></div>
      <div class="row"><button class="primary grow" type="submit">Save guide</button><button type="button" id="prev">Preview</button></div>
      <div class="guide-body card hidden" id="preview" style="margin-top:12px"></div>
    </form>`;
  const f = $('#gForm');
  $('#prev').addEventListener('click', () => {
    $('#preview').classList.remove('hidden');
    $('#preview').innerHTML = renderGuide(f.body.value);
  });
  f.addEventListener('submit', guard(async () => {
    const d = formData(f);
    const res = id ? await api('PUT', `/guides/${id}`, d) : await api('POST', '/guides', d);
    toast('Guide saved');
    location.hash = `#/guide/${id || res.id}`;
  }));
}

// ----- Properties (aerial photos) -----
function propertyModal(p, after) {
  openModal(`<h2>${p ? 'Edit property' : 'Add property'}</h2><form id="propForm">
    <div class="field"><label>Name</label><input name="name" required maxlength="80" value="${esc(p?.name || '')}" placeholder="Home place"></div>
    <div class="field"><label>Notes (optional)</label><textarea name="notes" style="min-height:70px" maxlength="2000">${esc(p?.notes || '')}</textarea></div>
    ${p ? '' : '<div class="field"><label>Aerial photo</label><input type="file" name="photo" accept="image/*"><p class="muted small">You can also add or replace it later.</p></div>'}
    <div class="row"><button class="primary grow" type="submit">Save</button><button type="button" data-close>Cancel</button></div></form>`);
  $('#propForm').addEventListener('submit', guard(async (e) => {
    const f = e.target;
    const d = { name: f.name.value, notes: f.notes.value };
    let pid = p?.id;
    if (p) await api('PUT', `/properties/${p.id}`, d);
    else pid = (await api('POST', '/properties', d)).id;
    const file = f.photo?.files[0];
    if (file) {
      toast('Uploading photo…');
      await uploadPhoto(pid, file);
    }
    closeModal();
    toast('Saved');
    after(pid);
  }));
}

async function viewProperties() {
  const props = await api('GET', '/properties');
  main.innerHTML = `<div class="row between"><h1>Properties</h1>
      ${isOwner() ? '<button class="primary" id="addProp">+ Add property</button>' : ''}</div>
    <p class="muted">Pick a property on a task and its aerial photo is shown with the task, with the spot marked.</p>
    ${props.map((p) => `<a class="list-link" href="#/property/${p.id}"><div class="card prop-card">
      ${p.has_photo ? `<img class="thumb" src="${photoUrl(p)}" alt="" loading="lazy">` : '<div class="thumb empty-thumb">No photo yet</div>'}
      <div><b>${esc(p.name)}</b><div class="small muted">${p.open_tasks} open task(s)</div></div></div></a>`).join('')
      || `<div class="empty card">${isOwner() ? 'No properties yet. Tap <b>+ Add property</b> and upload an aerial photo of each one.' : 'No properties have been added yet.'}</div>`}`;
  $('#addProp')?.addEventListener('click', () => propertyModal(null, (pid) => (location.hash = `#/property/${pid}`)));
}

async function viewProperty(id) {
  const p = await api('GET', `/properties/${id}`);
  const pinned = p.tasks.filter((t) => t.pin_x != null);
  main.innerHTML = `<p><a href="#/properties">← Properties</a></p>
    <div class="row between"><h1 style="margin:0">${esc(p.name)}</h1>
      <a class="btn primary" href="#/task/new?property=${p.id}">+ Task here</a></div>
    ${p.notes ? `<p class="desc">${esc(p.notes)}</p>` : ''}
    <div class="card" style="margin-top:12px">
      ${p.has_photo ? `${photoWithPins(p, pinned.map((t, i) => ({ x: t.pin_x, y: t.pin_y, label: i + 1, cls: pinClass(t), href: `#/task/${t.id}`, title: t.title })))}
        <p class="small muted" style="margin-bottom:0"><span class="dot late"></span> overdue · <span class="dot today"></span> today ·
          <span class="dot soon"></span> upcoming · <span class="dot anytime"></span> anytime ·
          <a href="${photoUrl(p)}" target="_blank" rel="noopener">Full-size photo</a></p>`
        : `<div class="empty">No aerial photo yet.${isOwner() ? ' Tap <b>Upload photo</b> below.' : ''}</div>`}
    </div>
    <h2>Open tasks</h2>
    ${p.tasks.map((t) => {
      const n = pinned.indexOf(t);
      return `<a class="list-link" href="#/task/${t.id}"><div class="card row">
        ${n >= 0 ? `<span class="pin static ${pinClass(t)}">${n + 1}</span>` : ''}
        <div class="grow"><b>${esc(t.title)}</b><div class="small muted">${t.due_date ? fmtDay(t.due_date) : 'Anytime'} · ${esc(t.assigned_name || 'Anyone')}${t.location_name ? ' · ' + esc(t.location_name) : ''}</div></div></div></a>`;
    }).join('') || '<p class="muted">No open tasks at this property.</p>'}
    ${isOwner() ? `<div class="row" style="margin-top:12px">
      <button id="photoBtn">${p.has_photo ? 'Replace photo' : 'Upload photo'}</button>
      <button id="editProp">Edit</button><button class="danger" id="delProp">Delete</button></div>
      <input type="file" id="photoIn" accept="image/*" hidden>` : ''}`;
  if (!isOwner()) return;
  $('#photoBtn').addEventListener('click', () => $('#photoIn').click());
  $('#photoIn').addEventListener('change', guard(async (e) => {
    const file = e.target.files[0];
    if (!file) return;
    toast('Uploading photo…');
    await uploadPhoto(p.id, file);
    toast('Photo saved');
    render();
  }));
  $('#editProp').addEventListener('click', () => propertyModal(p, render));
  $('#delProp').addEventListener('click', guard(async () => {
    if (!confirm(`Delete ${p.name}? Its tasks stay, just without a property.`)) return;
    await api('DELETE', `/properties/${p.id}`);
    location.hash = '#/properties';
  }));
}

// ----- Time -----
const EDIT_KIND = { add: 'Added punch', edit: 'Changed times', delete: 'Deleted punch', auto_clockout: 'Auto clock-out (14 hrs)', confirm: 'Confirmed auto clock-out' };
function editLine(x, showWho) {
  const span = (a, b) => `${a ? fmtDateTime(a) : '—'} → ${b ? fmtDateTime(b) : 'on clock'}`;
  const before = x.old_in ? span(x.old_in, x.old_out) : '';
  const after = x.new_in ? span(x.new_in, x.new_out) : '';
  return `<div style="padding:8px 0;border-bottom:1px solid var(--line)">
    <div class="row between"><b>${showWho ? esc(x.employee_name) + ' · ' : ''}${EDIT_KIND[x.kind] || esc(x.kind)}</b>
      <span class="small muted">${fmtDateTime(x.created_at)}</span></div>
    <div class="small">${before ? `<span class="muted">Was:</span> ${before}<br>` : ''}${after ? `<span class="muted">Now:</span> ${after}` : ''}</div>
    <div class="small muted">By ${x.editor_name ? esc(x.editor_name) : 'the system'}${x.reason ? ` — “${esc(x.reason)}”` : ''}</div></div>`;
}
function punchTags(e) {
  return [e.auto_closed ? `<span class="tag pending">${e.needs_review ? 'Auto clock-out · not confirmed' : 'Auto clock-out'}</span>` : '',
    e.edited ? `<span class="tag flagged">Edited${e.edited_by_name ? ' by ' + esc(e.edited_by_name) : ''}</span>` : ''].join(' ');
}

async function viewTime(query) {
  const rk = query.get('range') || 'period';
  const r = ranges()[rk] || ranges().period;
  if (isOwner()) await loadUsers();
  const [entries, payroll, edits] = await Promise.all([
    api('GET', `/time?from=${r.from}&to=${r.to}`),
    isOwner() ? api('GET', `/payroll?from=${r.from}&to=${r.to}`) : null,
    api('GET', `/time/edits?from=${r.from}&to=${r.to}`),
    refreshClock(),
  ]);
  const hoursOf = (e) => ((e.clock_out ? new Date(e.clock_out) : new Date()) - new Date(e.clock_in)) / 3600000;
  const myTotal = entries.filter((e) => e.user_id === S.user.id).reduce((s, e) => s + hoursOf(e), 0);
  const canEdit = (e) => isOwner() || e.user_id === S.user.id;
  main.innerHTML = `
    <div class="card clock-card" id="clockCard">${clockCardInner()}</div>
    <h1>${isOwner() ? 'Time &amp; payroll' : 'My time'}</h1>
    ${rangeChips(rk)}
    <p class="muted small">${fmtDay(r.from)} – ${fmtDay(r.to)}</p>
    ${isOwner() ? `<div class="card">
      <div class="row between"><h2 style="margin:0">Payroll summary</h2>
        <div class="row"><a class="btn" href="/api/payroll.csv?from=${r.from}&to=${r.to}">⬇ CSV</a>
        ${S.emailEnabled ? '<button class="primary" id="emailPayroll">✉ Email to payroll</button>' : ''}</div></div>
      ${payroll.openEntries ? `<p class="warn">${payroll.openEntries} person(s) still clocked in. Their hours count up to now.</p>` : ''}
      <div class="table-wrap"><table><thead><tr><th>Employee</th><th class="num">Hours</th><th class="num">Changed by hand</th><th class="num">Auto clock-outs</th></tr></thead><tbody>
      ${payroll.summary.map((s) => `<tr><td>${esc(s.name)}${s.open ? ' <span class="tag pending">on clock</span>' : ''}</td>
        <td class="num"><b>${hrs(s.total)}</b></td><td class="num">${s.edited || '—'}</td>
        <td class="num">${s.auto ? s.auto + (s.unconfirmed ? ` (${s.unconfirmed} not confirmed)` : '') : '—'}</td></tr>`).join('')
        || '<tr><td colspan="4" class="muted">No hours in this range.</td></tr>'}
      </tbody></table></div>
      <p class="muted small">Pay periods run the 1st–15th and the 16th–end of the month.
        ${S.emailEnabled ? (S.settings.payroll_email ? `Emails go to ${esc(S.settings.payroll_email)}.` : 'Set the payroll email in Settings.') : 'Download the CSV and send it to payroll, or set up email (see README).'}</p>
    </div>` : `<div class="card"><b>${hrs(myTotal)} hrs</b> in this range</div>`}
    <div class="section-title"><h2>${isOwner() ? 'All punches' : 'My punches'}</h2><button id="addPunch">+ Add missed punch</button></div>
    <div class="card table-wrap"><table><thead><tr>${isOwner() ? '<th>Who</th>' : ''}<th>Date</th><th>In</th><th>Out</th><th class="num">Hrs</th><th></th></tr></thead><tbody>
      ${entries.map((e) => {
        const tags = punchTags(e);
        return `<tr>${isOwner() ? `<td>${esc(e.name)}</td>` : ''}<td>${fmtDay(e.work_date)}</td><td>${fmtTime(e.clock_in)}</td>
          <td>${e.clock_out ? fmtTime(e.clock_out) : '<span class="tag pending">on clock</span>'}</td><td class="num">${hrs(hoursOf(e))}</td>
          <td class="right">${canEdit(e) ? `<button class="link" data-edit="${e.id}">Edit</button>` : ''}</td></tr>
          ${tags || e.note ? `<tr><td colspan="${isOwner() ? 6 : 5}" class="small" style="border-top:none;padding-top:0">${tags}
            ${e.note ? `<span class="muted">${esc(e.note)}</span>` : ''}
            ${tags ? `<button class="link small" data-hist="${e.id}">History</button>` : ''}</td></tr>` : ''}`;
      }).join('') || '<tr><td colspan="6" class="muted">No punches.</td></tr>'}
    </tbody></table></div>
    <div class="section-title"><h2>Change log</h2><span class="muted small">${edits.length}</span></div>
    <div class="card">${edits.map((x) => editLine(x, isOwner())).join('') || '<p class="muted" style="margin:0">No manual changes in this range.</p>'}</div>`;
  $$('[data-range]').forEach((b) => b.addEventListener('click', () => (location.hash = `#/time?range=${b.dataset.range}`)));
  $('#emailPayroll')?.addEventListener('click', guard(async () => {
    if (!confirm(`Email payroll for ${r.from} to ${r.to}?`)) return;
    const res = await api('POST', '/payroll/email', { from: r.from, to: r.to });
    toast(`Sent to ${res.sentTo}`);
  }));
  const punchModal = (e) => {
    openModal(`<h2>${e ? 'Change punch' : 'Add missed punch'}</h2><form id="punchForm">
      ${isOwner() ? `<div class="field"><label>Employee</label><select name="user_id" ${e ? 'disabled' : 'required'}>${userOptions(e?.user_id, { blank: '— pick —' })}</select></div>` : ''}
      <div class="field"><label>Clock in</label><input type="datetime-local" name="clock_in" required value="${toLocalInput(e?.clock_in)}"></div>
      <div class="field"><label>Clock out</label><input type="datetime-local" name="clock_out" ${e && !e.clock_out ? '' : 'required'} value="${toLocalInput(e?.clock_out)}"></div>
      <div class="field"><label>Reason${isOwner() ? ' (optional)' : ''}</label><input name="reason" maxlength="500" ${isOwner() ? '' : 'required'} placeholder="Forgot to clock in this morning"></div>
      <p class="muted small">${isOwner() ? 'Changes are kept in the change log.' : 'The owner can see every change you make.'}</p>
      <div class="row"><button class="primary grow" type="submit">Save</button>
        ${e && isOwner() ? '<button type="button" class="danger" id="delPunch">Delete</button>' : ''}<button type="button" data-close>Cancel</button></div></form>`);
    $('#punchForm').addEventListener('submit', guard(async (ev) => {
      const d = formData(ev.target);
      const body = { ...d, clock_in: fromLocalInput(d.clock_in), clock_out: fromLocalInput(d.clock_out) };
      e ? await api('PUT', `/time/${e.id}`, body) : await api('POST', '/time', body);
      closeModal();
      toast('Saved');
      await refreshClock();
      render();
    }));
    $('#delPunch')?.addEventListener('click', guard(async () => {
      if (!confirm('Delete this punch? It stays in the change log.')) return;
      await api('DELETE', `/time/${e.id}`);
      closeModal();
      render();
    }));
  };
  $('#addPunch').addEventListener('click', () => punchModal(null));
  $$('[data-edit]').forEach((b) => b.addEventListener('click', () => punchModal(entries.find((x) => x.id === Number(b.dataset.edit)))));
  $$('[data-hist]').forEach((b) => b.addEventListener('click', guard(async () => {
    const list = await api('GET', `/time/edits?entry_id=${b.dataset.hist}`);
    openModal(`<h2>Punch history</h2>${list.map((x) => editLine(x, false)).join('') || '<p class="muted">No changes.</p>'}
      <div class="row" style="margin-top:12px"><button data-close class="grow">Close</button></div>`);
  })));
}

// ----- More / review / team / settings -----
function viewMore() {
  main.innerHTML = `<h1>${esc(S.user.name)}</h1><p class="muted">${S.user.role === 'owner' ? 'Owner' : 'Hand'} · @${esc(S.user.username)}</p>
    <div class="card menu">
      ${isOwner() ? `<a href="#/review">Review completed tasks <span id="pendingCount" class="muted"></span></a>` : ''}
      <a href="#/team">${isOwner() ? 'Team &amp; productivity' : 'My productivity'} <span>›</span></a>
      <a href="#/closed">Finished &amp; archived tasks <span>›</span></a>
      ${isOwner() ? '<a href="#/settings">Settings <span>›</span></a>' : ''}
      <a href="#/password">Change password / PIN <span>›</span></a>
      <a href="#/logout">Log out <span>›</span></a>
    </div>
    <p class="muted small">Tip: on iPhone, tap Share → <b>Add to Home Screen</b> to use this like an app.</p>`;
  if (isOwner()) api('GET', '/completions?review=pending').then((p) => { const el = $('#pendingCount'); if (el) el.textContent = `${p.length} waiting ›`; });
}

async function viewReview(query) {
  if (!isOwner()) { location.hash = '#/more'; return; }
  const st = query.get('s') || 'pending';
  const list = await api('GET', `/completions?review=${st}`);
  main.innerHTML = `<p><a href="#/more">← More</a></p><div class="row between"><h1>Review completed work</h1>
      ${st === 'pending' && list.length ? '<button id="approveAll">Approve all</button>' : ''}</div>
    <div class="chips">${['pending', 'flagged', 'approved'].map((s) => `<button class="chip ${s === st ? 'on' : ''}" data-s="${s}">${s[0].toUpperCase() + s.slice(1)}</button>`).join('')}</div>
    ${list.map((c) => `<div class="card">
      <div class="row between"><a href="#/task/${c.task_id}"><b>${esc(c.task_title)}</b></a><span class="tag ${c.review_status}">${c.review_status}</span></div>
      <div class="small muted">${esc(c.user_name)} · ${fmtDateTime(c.completed_at)}
        ${c.due_date ? ` · due ${fmtDay(c.due_date)}` : ''} ${c.due_date && c.completed_on > c.due_date ? '<span class="tag late">late</span>' : ''}</div>
      ${c.notes ? `<p class="desc">${esc(c.notes)}</p>` : ''}
      ${c.review_note ? `<p class="small"><b>Review note:</b> ${esc(c.review_note)}</p>` : ''}
      <div class="row">
        ${c.review_status !== 'approved' ? `<button class="ok" data-approve="${c.id}">✓ Approve</button>` : ''}
        ${c.review_status !== 'flagged' ? `<button class="danger" data-flag="${c.id}">⚑ Flag</button>` : ''}
      </div></div>`).join('') || `<div class="empty card">Nothing ${st}.</div>`}`;
  $$('[data-s]').forEach((b) => b.addEventListener('click', () => (location.hash = `#/review?s=${b.dataset.s}`)));
  $$('[data-approve]').forEach((b) => b.addEventListener('click', guard(async () => {
    await api('POST', `/completions/${b.dataset.approve}/review`, { status: 'approved' });
    refreshBadge();
    render();
  })));
  $$('[data-flag]').forEach((b) => b.addEventListener('click', () => {
    openModal(`<h2>Flag this work</h2><form id="flagForm">
      <div class="field"><label>What needs fixing?</label><textarea name="note" required placeholder="Missed the fence line along the creek"></textarea></div>
      <label class="inline-check"><input type="checkbox" name="reopen" checked> Put a one-time task back on the list</label>
      <div class="row" style="margin-top:12px"><button class="danger grow" type="submit">Flag</button><button type="button" data-close>Cancel</button></div></form>`);
    $('#flagForm').addEventListener('submit', guard(async (e) => {
      const d = formData(e.target);
      await api('POST', `/completions/${b.dataset.flag}/review`, { status: 'flagged', note: d.note, reopen: Boolean(d.reopen) });
      closeModal();
      refreshBadge();
      render();
    }));
  }));
  $('#approveAll')?.addEventListener('click', guard(async () => {
    if (!confirm(`Approve all ${list.length} pending?`)) return;
    await api('POST', '/completions/approve-all', {});
    refreshBadge();
    render();
  }));
}

async function viewTeam(query) {
  const rk = query.get('range') || 'period';
  const r = ranges()[rk] || ranges().period;
  const [stats] = await Promise.all([api('GET', `/stats?from=${r.from}&to=${r.to}`), isOwner() ? loadUsers() : null]);
  const pct = (x) => (x == null ? '—' : Math.round(x * 100) + '%');
  main.innerHTML = `<p><a href="#/more">← More</a></p><h1>${isOwner() ? 'Team productivity' : 'My productivity'}</h1>
    ${rangeChips(rk)}
    <p class="muted small">${fmtDay(r.from)} – ${fmtDay(r.to)}</p>
    <div class="card table-wrap"><table><thead><tr><th>Name</th><th class="num">Hours</th><th class="num">Tasks done</th>
      <th class="num">Tasks/day</th><th class="num">On time</th><th class="num">Flagged</th><th class="num">Time changes</th></tr></thead><tbody>
      ${stats.rows.map((x) => `<tr><td>${esc(x.name)}</td><td class="num">${hrs(x.hours)}</td><td class="num"><b>${x.completed}</b></td>
        <td class="num">${x.tasks_per_day.toFixed(1)}</td>
        <td class="num">${x.completed ? pct(x.on_time / x.completed) : '—'}</td>
        <td class="num">${x.flagged || 0}</td>
        <td class="num">${x.time_changes + x.auto_clockouts || 0}</td></tr>`).join('')}
    </tbody></table></div>
    <p class="muted small"><b>On time</b> = finished on or before the due date. <b>Flagged</b> = work the owner sent back.
      <b>Time changes</b> = punches changed by hand or auto clocked out (see the Time tab's change log).</p>
    ${isOwner() ? `<div class="section-title"><h2>People</h2><button id="addUser">+ Add person</button></div>
      <div class="card">${S.users.map((u) => `<div class="row between" style="padding:8px 0;border-bottom:1px solid var(--line)">
        <span><b>${esc(u.name)}</b> <span class="muted small">@${esc(u.username)}</span> <span class="tag">${u.role}</span>
          ${u.active ? '' : '<span class="tag">inactive</span>'}</span>
        <button class="link" data-user="${u.id}">Edit</button></div>`).join('')}</div>
      <p class="muted small">Passwords are stored scrambled and can't be shown. To give someone a new one, tap <b>Edit</b> and type a new password or PIN.</p>` : ''}`;
  $$('[data-range]').forEach((b) => b.addEventListener('click', () => (location.hash = `#/team?range=${b.dataset.range}`)));
  const userModal = (u) => {
    openModal(`<h2>${u ? 'Edit ' + esc(u.name) : 'Add person'}</h2><form id="userForm">
      <div class="field"><label>Name</label><input name="name" required value="${esc(u?.name || '')}"></div>
      ${u ? '' : '<div class="field"><label>Username</label><input name="username" required autocapitalize="none"></div>'}
      <div class="field"><label>Role</label><select name="role"><option value="hand">Hand</option><option value="owner" ${u?.role === 'owner' ? 'selected' : ''}>Owner</option></select></div>
      <div class="field"><label>${u ? 'Set a new password / PIN (leave blank to keep the current one)' : 'Password or PIN (4+ characters)'}</label>
        <input name="password" type="text" autocomplete="off" ${u ? '' : 'required minlength="4"'}></div>
      ${u ? `<label class="inline-check"><input type="checkbox" name="active" ${u.active ? 'checked' : ''}> Active (can log in)</label>` : ''}
      <div class="row" style="margin-top:12px"><button class="primary grow" type="submit">Save</button><button type="button" data-close>Cancel</button></div></form>`);
    $('#userForm').addEventListener('submit', guard(async (e) => {
      const d = formData(e.target);
      if (u) await api('PUT', `/users/${u.id}`, { ...d, active: Boolean(d.active) });
      else await api('POST', '/users', d);
      closeModal();
      toast(d.password ? `Saved. Their password/PIN is now: ${d.password}` : 'Saved');
      render();
    }));
  };
  $('#addUser')?.addEventListener('click', () => userModal(null));
  $$('[data-user]').forEach((b) => b.addEventListener('click', () => userModal(S.users.find((x) => x.id === Number(b.dataset.user)))));
}

function viewSettings() {
  if (!isOwner()) { location.hash = '#/more'; return; }
  const s = S.settings;
  const zones = Intl.supportedValuesOf ? Intl.supportedValuesOf('timeZone') : [s.timezone];
  main.innerHTML = `<p><a href="#/more">← More</a></p><h1>Settings</h1>
    <form id="setForm" class="card">
      <div class="field"><label>Ranch name</label><input name="ranch_name" required value="${esc(s.ranch_name)}"></div>
      <div class="field"><label>Time zone</label><select name="timezone">${zones.map((z) => `<option ${z === s.timezone ? 'selected' : ''}>${esc(z)}</option>`).join('')}</select></div>
      <h2>Payroll</h2>
      <p class="muted small">Pay periods run the 1st–15th and the 16th–end of each month. Anyone still on the clock after 14 hours is clocked out automatically and asked to fix it next time they open the app.</p>
      <div class="field"><label>Payroll email (where reports go)</label><input type="email" name="payroll_email" value="${esc(s.payroll_email)}" placeholder="payroll@example.com"></div>
      <label class="inline-check"><input type="checkbox" name="payroll_auto_email" value="1" ${s.payroll_auto_email === '1' ? 'checked' : ''} ${S.emailEnabled ? '' : 'disabled'}>
        Email the pay period that just ended on the 1st and 16th (8 am)</label>
      ${S.emailEnabled ? '' : '<p class="muted small">Email sending isn\'t set up on the server yet. See README "Emailing payroll". You can still download the CSV from the Time tab.</p>'}
      <button class="primary big" type="submit" style="margin-top:16px">Save settings</button>
    </form>`;
  const f = $('#setForm');
  f.addEventListener('submit', guard(async () => {
    const d = formData(f);
    d.payroll_auto_email = d.payroll_auto_email === '1';
    S.settings = await api('PUT', '/settings', d);
    $('#brand').textContent = S.settings.ranch_name;
    toast('Settings saved');
  }));
}

function viewPassword() {
  main.innerHTML = `<p><a href="#/more">← More</a></p><h1>Change password / PIN</h1>
    <form id="pwForm" class="card">
      <div class="field"><label>Current password / PIN</label><input type="password" name="current" required autocomplete="current-password"></div>
      <div class="field"><label>New password / PIN (4+ characters)</label><input type="password" name="password" required minlength="4" autocomplete="new-password"></div>
      <button class="primary big" type="submit">Change it</button></form>`;
  $('#pwForm').addEventListener('submit', guard(async (e) => {
    await api('POST', '/me/password', formData(e.target));
    toast('Password changed');
    location.hash = '#/more';
  }));
}

async function logout() {
  await api('POST', '/logout', {}).catch(() => {});
  S.user = null;
  location.hash = '#/login';
}

// ---------- router ----------
const ROUTES = [
  [/^\/?$/, viewTasks, 'today'],
  [/^\/task\/new$/, (m, q) => viewTaskForm(null, q), 'today'],
  [/^\/task\/(\d+)$/, (m) => viewTask(m[1]), 'today'],
  [/^\/task\/(\d+)\/edit$/, (m, q) => viewTaskForm(m[1], q), 'today'],
  [/^\/closed$/, viewClosed, 'more'],
  [/^\/guides$/, viewGuides, 'guides'],
  [/^\/guide\/new$/, () => viewGuideForm(null), 'guides'],
  [/^\/guide\/(\d+)$/, (m) => viewGuide(m[1]), 'guides'],
  [/^\/guide\/(\d+)\/edit$/, (m) => viewGuideForm(m[1]), 'guides'],
  [/^\/properties$/, viewProperties, 'props'],
  [/^\/property\/(\d+)$/, (m) => viewProperty(m[1]), 'props'],
  [/^\/time$/, (m, q) => viewTime(q), 'time'],
  [/^\/more$/, viewMore, 'more'],
  [/^\/review$/, (m, q) => viewReview(q), 'more'],
  [/^\/team$/, (m, q) => viewTeam(q), 'more'],
  [/^\/settings$/, viewSettings, 'more'],
  [/^\/password$/, viewPassword, 'more'],
  [/^\/logout$/, logout, 'more'],
];

let renderSeq = 0;
async function render() {
  const seq = ++renderSeq;
  const [path, qs] = (location.hash.slice(1) || '/').split('?');
  const query = new URLSearchParams(qs || '');
  if (path === '/setup') return viewSetup();
  if (!S.user || path === '/login') return S.user ? (location.hash = '#/') : viewLogin();
  $('#topbar').hidden = $('#tabs').hidden = false;
  closeModal();
  for (const [re, fn, tab] of ROUTES) {
    const m = path.match(re);
    if (!m) continue;
    $$('#tabs a').forEach((a) => a.classList.toggle('active', a.dataset.tab === tab));
    if (main.dataset.path !== path) { main.innerHTML = '<div class="loading">Loading…</div>'; window.scrollTo(0, 0); }
    main.dataset.path = path;
    try {
      await fn(m, query);
    } catch (err) {
      if (seq === renderSeq) main.innerHTML = `<div class="card empty">${esc(err.message)}<br><a href="#/">Back to tasks</a></div>`;
    }
    return;
  }
  main.innerHTML = '<div class="card empty">Page not found. <a href="#/">Back to tasks</a></div>';
}

async function boot() {
  const st = await api('GET', '/status');
  Object.assign(S, { user: st.user, settings: st.settings, today: st.today, emailEnabled: st.emailEnabled });
  $('#brand').textContent = st.settings.ranch_name || 'Ranch Tasks';
  document.title = st.settings.ranch_name || 'Ranch Tasks';
  if (st.needsSetup) { location.hash = '#/setup'; return viewSetup(); }
  if (!st.user) { if (location.hash !== '#/login') location.hash = '#/login'; else viewLogin(); return; }
  if (location.hash === '#/login' || location.hash === '#/setup') location.hash = '#/';
  await loadUsers().catch(() => {});
  refreshClock();
  refreshBadge();
  render();
}

window.addEventListener('hashchange', () => { if (S.user || /login|setup/.test(location.hash)) render(); });
// Refresh "today" and the clock when the app comes back to the foreground.
document.addEventListener('visibilitychange', async () => {
  if (document.visibilityState !== 'visible' || !S.user) return;
  try {
    const st = await api('GET', '/status');
    if (st.today !== S.today) { S.today = st.today; render(); }
    refreshClock();
    refreshBadge();
  } catch { /* ignore */ }
});

boot().catch((err) => { main.innerHTML = `<div class="card empty">Could not load: ${esc(err.message)}</div>`; });
