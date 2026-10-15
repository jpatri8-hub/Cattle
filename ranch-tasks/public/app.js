import { esc, renderGuide } from './md.js';
import { fileToGeoJSON } from './geo.js';
import { describeRule, addDays, parseDate } from './recurrence.js';

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

function getPosition() {
  return new Promise((resolve) => {
    if (!navigator.geolocation) return resolve(null);
    navigator.geolocation.getCurrentPosition(
      (p) => resolve({ lat: p.coords.latitude, lng: p.coords.longitude }),
      () => resolve(null),
      { enableHighAccuracy: true, timeout: 8000, maximumAge: 60000 }
    );
  });
}

// Date ranges for reports.
function ranges() {
  const ws = Number(S.settings.week_start || 0);
  const dow = parseDate(S.today).getUTCDay();
  const thisWeek = addDays(S.today, -((dow - ws + 7) % 7));
  const monthStart = S.today.slice(0, 8) + '01';
  return {
    week: { label: 'This week', from: thisWeek, to: S.today },
    lastweek: { label: 'Last week', from: addDays(thisWeek, -7), to: addDays(thisWeek, -1) },
    two: { label: 'Last 2 weeks', from: addDays(thisWeek, -7), to: S.today },
    month: { label: 'This month', from: monthStart, to: S.today },
    d30: { label: 'Last 30 days', from: addDays(S.today, -29), to: S.today },
  };
}
function rangeChips(active, attr = 'data-range') {
  return `<div class="chips">${Object.entries(ranges()).map(([k, r]) =>
    `<button class="chip ${k === active ? 'on' : ''}" ${attr}="${k}">${r.label}</button>`).join('')}</div>`;
}

// ---------- maps ----------
function baseLayers() {
  const esri = (svc) => `https://server.arcgisonline.com/ArcGIS/rest/services/${svc}/MapServer/tile/{z}/{y}/{x}`;
  return {
    Satellite: L.tileLayer(esri('World_Imagery'), { maxZoom: 19, attribution: 'Imagery © Esri' }),
    Topo: L.tileLayer(esri('World_Topo_Map'), { maxZoom: 19, attribution: '© Esri' }),
    Street: L.tileLayer('https://tile.openstreetmap.org/{z}/{x}/{y}.png', { maxZoom: 19, attribution: '© OpenStreetMap' }),
  };
}
function makeMap(el, { center, zoom } = {}) {
  const base = baseLayers();
  const map = L.map(el, { layers: [base.Satellite] });
  const c = center || [Number(S.settings.map_lat), Number(S.settings.map_lng)];
  map.setView(c, zoom || Number(S.settings.map_zoom) || 14);
  return { map, base };
}
function layerToLeaflet(layer, onPoint) {
  return L.geoJSON(layer.geojson, {
    style: { color: layer.color, weight: 3, fillOpacity: 0.12 },
    pointToLayer: (f, ll) => L.circleMarker(ll, { radius: 6, color: '#fff', weight: 2, fillColor: layer.color, fillOpacity: 1 }),
    onEachFeature: (f, l) => {
      const name = f.properties?.name;
      if (name) l.bindTooltip(name);
      if (onPoint && f.geometry.type === 'Point') {
        l.on('click', () => onPoint(f.geometry.coordinates[1], f.geometry.coordinates[0], name || ''));
      } else if (name || f.properties?.description) {
        l.bindPopup(`<b>${esc(name || '')}</b><div>${esc(f.properties?.description || '')}</div>`);
      }
    },
  });
}
function taskColor(t) {
  if (!t.due_date) return '#1e88e5';
  if (t.due_date < S.today) return '#d32f2f';
  if (t.due_date === S.today) return '#f57c00';
  return '#43a047';
}
const mapsLink = (lat, lng) => `https://www.google.com/maps/dir/?api=1&destination=${lat},${lng}`;

// ---------- clock ----------
let clockTick;
async function refreshClock() {
  try { S.clock = await api('GET', '/time/status'); } catch { return; }
  paintClock();
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
  if (c.open) {
    return `<div class="status">Clocked in since <b>${fmtTime(c.open.clock_in)}</b></div>
      <div class="timer" id="clockTimer">${duration(Date.now() - new Date(c.open.clock_in))}</div>
      <div class="muted small" style="margin-bottom:10px">This week: ${hrs(c.weekHours)} hrs</div>
      <button class="big danger" data-clock="out">Clock out</button>`;
  }
  return `<div class="status">You're <b>off the clock</b></div>
    <div class="muted small" style="margin-bottom:10px">Today: ${hrs(c.todayHours)} hrs · This week: ${hrs(c.weekHours)} hrs</div>
    <button class="big ok" data-clock="in">Clock in</button>`;
}
document.addEventListener('click', async (e) => {
  const b = e.target.closest('[data-clock]');
  if (!b || b.disabled) return;
  if (b.dataset.clock === 'out' && !confirm('Clock out now?')) return;
  b.disabled = true;
  try {
    const pos = await getPosition();
    if (b.dataset.clock === 'in') {
      await api('POST', '/time/clock-in', pos || {});
      toast('Clocked in. Have a good one!');
    } else {
      await api('POST', '/time/clock-out', pos || {});
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
  const est = task.est_minutes ?? '';
  openModal(`<h2>Mark done: ${esc(task.title)}</h2>
    <form id="doneForm" class="stack">
      <div class="field"><label for="dm">Time spent (minutes)</label>
        <input id="dm" name="minutes_spent" type="number" inputmode="numeric" min="0" value="${esc(est)}" placeholder="e.g. 45"></div>
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
  if (t.lat != null) meta.push(`<span>📍 ${esc(t.location_name || 'Map')}</span>`);
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
    ${t.guide ? `<div class="card"><div class="row between"><h2 style="margin:0">📘 ${esc(t.guide.title)}</h2>
        <a href="#/guide/${t.guide.id}" class="small">Open guide</a></div>
        <p class="muted small">Tick off steps as you go.</p>
        <div class="guide-body" id="guideBody">${renderGuide(t.guide.body, { checklist: true })}</div></div>` : ''}
    ${t.lat != null ? `<div class="card"><div class="row between"><h2 style="margin:0">📍 ${esc(t.location_name || 'Location')}</h2>
        <a class="small" target="_blank" rel="noopener" href="${mapsLink(t.lat, t.lng)}">Directions</a></div>
        <div class="mini-map" id="miniMap" style="margin-top:8px"></div></div>` : ''}
    <div class="card"><h2 style="margin-top:0">History</h2>
      ${t.history.length ? t.history.map((c) => `<div style="padding:6px 0;border-bottom:1px solid var(--line)">
        <div class="row between"><b>${esc(c.user_name)}</b><span class="tag ${c.review_status}">${c.review_status}</span></div>
        <div class="small muted">${fmtDateTime(c.completed_at)}${c.minutes_spent != null ? ` · ${c.minutes_spent} min` : ''}${c.due_date && c.completed_on > c.due_date ? ' · <span class="tag late">late</span>' : ''}</div>
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
  if (t.lat != null) {
    const { map } = makeMap($('#miniMap'), { center: [t.lat, t.lng], zoom: 16 });
    L.circleMarker([t.lat, t.lng], { radius: 10, color: '#fff', weight: 3, fillColor: taskColor(t), fillOpacity: 1 }).addTo(map);
  }
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
  const [guides] = await Promise.all([api('GET', '/guides'), loadUsers()]);
  let t = { title: '', description: '', priority: 'normal', recur_type: 'none', recur_interval: 1, recur_weekdays: '', due_date: S.today };
  if (id) t = await api('GET', `/tasks/${id}`);
  else if (query.get('copy')) {
    const src = await api('GET', `/tasks/${query.get('copy')}`);
    t = { ...src, title: src.title + ' (copy)', due_date: S.today };
  }
  if (query.get('guide')) t.guide_id = Number(query.get('guide'));
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
      <div class="field"><label>Location</label>
        <input name="location_name" maxlength="120" value="${esc(t.location_name || '')}" placeholder="North pasture gate">
        <input type="hidden" name="lat" value="${esc(t.lat ?? '')}"><input type="hidden" name="lng" value="${esc(t.lng ?? '')}">
        <div class="row" style="margin-top:6px">
          <button type="button" id="pickMap">📍 Pick on map</button>
          <button type="button" id="useGps">Use my GPS</button>
          <button type="button" class="link" id="clearLoc">Clear</button>
        </div>
        <p class="muted small" id="locText"></p></div>
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

  const showLoc = () => {
    $('#locText').textContent = form.lat.value ? `Pinned at ${Number(form.lat.value).toFixed(5)}, ${Number(form.lng.value).toFixed(5)}` : 'No map pin';
  };
  const setLoc = (lat, lng, name) => {
    form.lat.value = lat ?? '';
    form.lng.value = lng ?? '';
    if (name && !form.location_name.value) form.location_name.value = name;
    showLoc();
  };
  showLoc();
  $('#useGps').addEventListener('click', guard(async () => {
    const p = await getPosition();
    if (!p) throw new Error('Could not get your location (check location permission)');
    setLoc(p.lat, p.lng);
  }));
  $('#clearLoc').addEventListener('click', () => setLoc(null, null));
  $('#pickMap').addEventListener('click', guard(async () => {
    const layers = await api('GET', '/layers');
    openModal(`<h2>Tap the map to set the spot</h2>
      <p class="muted small">Tip: tap an imported onX waypoint to use it.</p>
      <div class="picker-map" id="pickerMap"></div>
      <div class="row" style="margin-top:10px"><button class="primary grow" id="pickOk">Use this spot</button><button data-close>Cancel</button></div>`);
    let pick = form.lat.value ? { lat: Number(form.lat.value), lng: Number(form.lng.value), name: '' } : null;
    const { map, base } = makeMap($('#pickerMap'), pick ? { center: [pick.lat, pick.lng], zoom: 16 } : {});
    L.control.layers(base).addTo(map);
    const marker = L.circleMarker([0, 0], { radius: 10, color: '#fff', weight: 3, fillColor: '#d32f2f', fillOpacity: 1 });
    const place = (lat, lng, name = '') => { pick = { lat, lng, name }; marker.setLatLng([lat, lng]).addTo(map); };
    if (pick) place(pick.lat, pick.lng);
    layers.filter((l) => l.visible).forEach((l) => layerToLeaflet(l, place).addTo(map));
    map.on('click', (e) => place(e.latlng.lat, e.latlng.lng));
    setTimeout(() => map.invalidateSize(), 50);
    $('#pickOk').addEventListener('click', () => {
      if (pick) setLoc(Math.round(pick.lat * 1e6) / 1e6, Math.round(pick.lng * 1e6) / 1e6, pick.name);
      closeModal();
    });
  }));

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

// ----- Map -----
async function viewMap() {
  const [tasks, layers] = await Promise.all([api('GET', '/tasks'), api('GET', '/layers')]);
  const pinned = tasks.filter((t) => t.lat != null);
  main.innerHTML = `<div class="row between" style="margin-bottom:8px"><h1 style="margin:0">Map</h1>
      <div class="row"><button id="locate">◎ Me</button><button id="importBtn">Import onX file</button></div></div>
    <div id="map"></div>
    <p class="small muted">● <span style="color:#d32f2f">overdue</span> · <span style="color:#f57c00">today</span> · <span style="color:#43a047">upcoming</span> · <span style="color:#1e88e5">anytime</span> — ${pinned.length} task(s) on map.
      ${tasks.length - pinned.length ? `${tasks.length - pinned.length} task(s) have no pin.` : ''}</p>
    <div class="card"><h2 style="margin-top:0">Imported layers</h2><div id="layerList"></div></div>
    <input type="file" id="fileIn" accept=".kml,.gpx,.geojson,.json" hidden>`;
  const { map, base } = makeMap($('#map'));
  const overlays = {};
  const bounds = [];
  for (const l of layers) {
    const ll = layerToLeaflet(l);
    overlays[esc(l.name)] = ll;
    if (l.visible) { ll.addTo(map); const b = ll.getBounds(); if (b.isValid()) bounds.push(b); }
  }
  const taskLayer = L.layerGroup().addTo(map);
  for (const t of pinned) {
    L.circleMarker([t.lat, t.lng], { radius: 10, color: '#fff', weight: 3, fillColor: taskColor(t), fillOpacity: 1 })
      .bindPopup(`<a href="#/task/${t.id}">${esc(t.title)}</a><br>${t.due_date ? fmtDay(t.due_date) : 'Anytime'} · ${esc(t.assigned_name || 'Anyone')}
        <br><a target="_blank" rel="noopener" href="${mapsLink(t.lat, t.lng)}">Directions</a>`)
      .addTo(taskLayer);
    bounds.push(L.latLngBounds([[t.lat, t.lng], [t.lat, t.lng]]));
  }
  overlays['Tasks'] = taskLayer;
  L.control.layers(base, overlays).addTo(map);
  if (bounds.length) map.fitBounds(bounds.reduce((a, b) => a.extend(b), L.latLngBounds(bounds[0].getSouthWest(), bounds[0].getNorthEast())), { padding: [30, 30], maxZoom: 17 });

  let me;
  $('#locate').addEventListener('click', guard(async () => {
    const p = await getPosition();
    if (!p) throw new Error('Could not get your location');
    me = me || L.circleMarker([0, 0], { radius: 8, color: '#fff', weight: 3, fillColor: '#1565c0', fillOpacity: 1 }).addTo(map);
    me.setLatLng([p.lat, p.lng]);
    map.setView([p.lat, p.lng], 16);
  }));

  $('#layerList').innerHTML = layers.length ? layers.map((l) => `<div class="row between" style="padding:6px 0">
      <span><span style="display:inline-block;width:14px;height:14px;border-radius:3px;background:${esc(l.color)}"></span> ${esc(l.name)}
      <span class="muted small">(${l.geojson.features.length} items${l.visible ? '' : ', hidden by default'})</span></span>
      ${isOwner() ? `<span><button class="link" data-lvis="${l.id}">${l.visible ? 'Hide' : 'Show'}</button><button class="link" data-ldel="${l.id}" style="color:var(--danger)">Delete</button></span>` : ''}
    </div>`).join('') : `<p class="muted small">No layers yet. In onX, open <b>Markups</b> (waypoints, lines, areas), select what you want,
      choose <b>Export</b> → <b>KML</b> or <b>GPX</b>, then tap <b>Import onX file</b> here. Property lines, gates, water tanks and pasture boundaries all work.</p>`;
  $$('[data-ldel]').forEach((b) => b.addEventListener('click', guard(async () => {
    if (!confirm('Delete this layer?')) return;
    await api('DELETE', `/layers/${b.dataset.ldel}`);
    render();
  })));
  $$('[data-lvis]').forEach((b) => b.addEventListener('click', guard(async () => {
    const l = layers.find((x) => x.id === Number(b.dataset.lvis));
    await api('PUT', `/layers/${l.id}`, { name: l.name, color: l.color, visible: !l.visible });
    render();
  })));

  $('#importBtn').addEventListener('click', () => $('#fileIn').click());
  $('#fileIn').addEventListener('change', guard(async (e) => {
    const file = e.target.files[0];
    if (!file) return;
    const gj = await fileToGeoJSON(file);
    openModal(`<h2>Import ${esc(file.name)}</h2><p>${gj.features.length} item(s) found.</p>
      <form id="layerForm"><div class="field"><label>Layer name</label><input name="name" required value="${esc(file.name.replace(/\.\w+$/, ''))}"></div>
      <div class="field"><label>Color</label><input type="color" name="color" value="#ff7800"></div>
      <div class="row"><button class="primary grow" type="submit">Import</button><button type="button" data-close>Cancel</button></div></form>`);
    $('#layerForm').addEventListener('submit', guard(async (ev) => {
      await api('POST', '/layers', { ...formData(ev.target), geojson: gj });
      closeModal();
      toast('Layer imported');
      render();
    }));
    e.target.value = '';
  }));
}

// ----- Time -----
async function viewTime(query) {
  const rk = query.get('range') || 'week';
  const r = ranges()[rk] || ranges().week;
  if (isOwner()) await loadUsers();
  const [entries, payroll] = await Promise.all([
    api('GET', `/time?from=${r.from}&to=${r.to}`),
    isOwner() ? api('GET', `/payroll?from=${r.from}&to=${r.to}`) : null,
    refreshClock(),
  ]);
  const myTotal = entries.filter((e) => e.user_id === S.user.id)
    .reduce((s, e) => s + ((e.clock_out ? new Date(e.clock_out) : new Date()) - new Date(e.clock_in)) / 3600000, 0);
  main.innerHTML = `
    <div class="card clock-card" id="clockCard">${clockCardInner()}</div>
    <h1>${isOwner() ? 'Time &amp; payroll' : 'My time'}</h1>
    ${rangeChips(rk)}
    <p class="muted small">${fmtDay(r.from)} – ${fmtDay(r.to)}</p>
    ${isOwner() ? `<div class="card">
      <div class="row between"><h2 style="margin:0">Payroll summary</h2>
        <div class="row"><a class="btn" href="/api/payroll.csv?from=${r.from}&to=${r.to}">⬇ CSV</a>
        ${S.emailEnabled ? '<button class="primary" id="emailPayroll">✉ Email to payroll</button>' : ''}</div></div>
      ${payroll.openEntries ? `<p class="warn">${payroll.openEntries} person(s) still clocked in — their hours count up to now.</p>` : ''}
      <div class="table-wrap"><table><thead><tr><th>Employee</th><th class="num">Regular</th><th class="num">Overtime</th><th class="num">Total</th></tr></thead><tbody>
      ${payroll.summary.map((s) => `<tr><td>${esc(s.name)}${s.open ? ' <span class="tag pending">on clock</span>' : ''}</td><td class="num">${hrs(s.regular)}</td><td class="num">${hrs(s.overtime)}</td><td class="num"><b>${hrs(s.total)}</b></td></tr>`).join('')
        || '<tr><td colspan="4" class="muted">No hours in this range.</td></tr>'}
      </tbody></table></div>
      <p class="muted small">Overtime = hours over ${esc(S.settings.overtime_hours)}/week (week starts ${S.settings.week_start === '1' ? 'Monday' : 'Sunday'}).
        ${S.emailEnabled ? (S.settings.payroll_email ? `Emails go to ${esc(S.settings.payroll_email)}.` : 'Set the payroll email in Settings.') : 'Download the CSV and upload/forward it to payroll, or set up email (see README).'}</p>
    </div>` : `<div class="card"><b>${hrs(myTotal)} hrs</b> in this range</div>`}
    <div class="section-title"><h2>${isOwner() ? 'All punches' : 'My punches'}</h2>
      ${isOwner() ? '<button id="addPunch">+ Add missed punch</button>' : ''}</div>
    <div class="card table-wrap"><table><thead><tr>${isOwner() ? '<th>Who</th>' : ''}<th>Date</th><th>In</th><th>Out</th><th class="num">Hrs</th>${isOwner() ? '<th></th>' : ''}</tr></thead><tbody>
      ${entries.map((e) => {
        const h = ((e.clock_out ? new Date(e.clock_out) : new Date()) - new Date(e.clock_in)) / 3600000;
        return `<tr>${isOwner() ? `<td>${esc(e.name)}</td>` : ''}<td>${fmtDay(e.work_date)}</td><td>${fmtTime(e.clock_in)}</td>
          <td>${e.clock_out ? fmtTime(e.clock_out) : '<span class="tag pending">on clock</span>'}</td><td class="num">${hrs(h)}</td>
          ${isOwner() ? `<td><button class="link" data-edit="${e.id}">Edit</button></td>` : ''}</tr>
          ${e.note || e.edited_by_name ? `<tr><td colspan="${isOwner() ? 6 : 4}" class="small muted" style="border-top:none;padding-top:0">${esc(e.note)}${e.edited_by_name ? ` (edited by ${esc(e.edited_by_name)})` : ''}</td></tr>` : ''}`;
      }).join('') || `<tr><td colspan="6" class="muted">No punches.</td></tr>`}
    </tbody></table></div>`;
  $$('[data-range]').forEach((b) => b.addEventListener('click', () => (location.hash = `#/time?range=${b.dataset.range}`)));
  $('#emailPayroll')?.addEventListener('click', guard(async () => {
    if (!confirm(`Email payroll for ${r.from} to ${r.to}?`)) return;
    const res = await api('POST', '/payroll/email', { from: r.from, to: r.to });
    toast(`Sent to ${res.sentTo}`);
  }));
  const punchModal = (e) => {
    openModal(`<h2>${e ? 'Edit punch' : 'Add missed punch'}</h2><form id="punchForm">
      <div class="field"><label>Employee</label><select name="user_id" ${e ? 'disabled' : 'required'}>${userOptions(e?.user_id, { blank: '— pick —' })}</select></div>
      <div class="field"><label>Clock in</label><input type="datetime-local" name="clock_in" required value="${toLocalInput(e?.clock_in)}"></div>
      <div class="field"><label>Clock out</label><input type="datetime-local" name="clock_out" value="${toLocalInput(e?.clock_out)}"></div>
      <div class="field"><label>Note</label><input name="note" value="${esc(e?.note || '')}" placeholder="Reason for change"></div>
      <div class="row"><button class="primary grow" type="submit">Save</button>${e ? '<button type="button" class="danger" id="delPunch">Delete</button>' : ''}<button type="button" data-close>Cancel</button></div></form>`);
    $('#punchForm').addEventListener('submit', guard(async (ev) => {
      const d = formData(ev.target);
      const body = { ...d, clock_in: fromLocalInput(d.clock_in), clock_out: fromLocalInput(d.clock_out) };
      e ? await api('PUT', `/time/${e.id}`, body) : await api('POST', '/time', body);
      closeModal();
      toast('Saved');
      refreshClock();
      render();
    }));
    $('#delPunch')?.addEventListener('click', guard(async () => {
      if (!confirm('Delete this punch?')) return;
      await api('DELETE', `/time/${e.id}`);
      closeModal();
      render();
    }));
  };
  $('#addPunch')?.addEventListener('click', () => punchModal(null));
  $$('[data-edit]').forEach((b) => b.addEventListener('click', () => punchModal(entries.find((x) => x.id === Number(b.dataset.edit)))));
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
      <div class="small muted">${esc(c.user_name)} · ${fmtDateTime(c.completed_at)}${c.minutes_spent != null ? ` · ${c.minutes_spent} min` : ''}
        ${c.due_date ? ` · due ${fmtDay(c.due_date)}` : ''} ${c.due_date && c.completed_on > c.due_date ? '<span class="tag late">late</span>' : ''}</div>
      ${c.notes ? `<p class="desc">${esc(c.notes)}</p>` : ''}
      ${c.review_note ? `<p class="small"><b>Review note:</b> ${esc(c.review_note)}</p>` : ''}
      <div class="row">
        ${c.review_status !== 'approved' ? `<button class="ok" data-approve="${c.id}">✓ Approve</button>` : ''}
        ${c.review_status !== 'flagged' ? `<button class="danger" data-flag="${c.id}">⚑ Flag</button>` : ''}
        ${c.lat != null ? `<a class="btn" target="_blank" rel="noopener" href="${mapsLink(c.lat, c.lng)}">📍</a>` : ''}
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
  const rk = query.get('range') || 'two';
  const r = ranges()[rk] || ranges().two;
  const [stats] = await Promise.all([api('GET', `/stats?from=${r.from}&to=${r.to}`), isOwner() ? loadUsers() : null]);
  const pct = (x) => (x == null ? '—' : Math.round(x * 100) + '%');
  main.innerHTML = `<p><a href="#/more">← More</a></p><h1>${isOwner() ? 'Team productivity' : 'My productivity'}</h1>
    ${rangeChips(rk)}
    <p class="muted small">${fmtDay(r.from)} – ${fmtDay(r.to)}</p>
    <div class="card table-wrap"><table><thead><tr><th>Name</th><th class="num">Hours</th><th class="num">Tasks done</th>
      <th class="num">Tasks/day</th><th class="num">Task time</th><th class="num">On time</th><th class="num">Flagged</th></tr></thead><tbody>
      ${stats.rows.map((x) => `<tr><td>${esc(x.name)}</td><td class="num">${hrs(x.hours)}</td><td class="num"><b>${x.completed}</b></td>
        <td class="num">${x.tasks_per_day.toFixed(1)}</td>
        <td class="num" title="Logged task minutes as a share of hours on the clock">${pct(x.utilization)}</td>
        <td class="num">${x.completed ? pct(x.on_time / x.completed) : '—'}</td>
        <td class="num">${x.flagged || 0}</td></tr>`).join('')}
    </tbody></table></div>
    <p class="muted small"><b>Task time</b> = minutes logged on completed tasks ÷ hours on the clock.
      <b>On time</b> = finished on or before the due date. <b>Flagged</b> = work the owner sent back.</p>
    ${isOwner() ? `<div class="section-title"><h2>People</h2><button id="addUser">+ Add person</button></div>
      <div class="card">${S.users.map((u) => `<div class="row between" style="padding:8px 0;border-bottom:1px solid var(--line)">
        <span><b>${esc(u.name)}</b> <span class="muted small">@${esc(u.username)}</span> <span class="tag">${u.role}</span>
          ${u.active ? '' : '<span class="tag">inactive</span>'}</span>
        <button class="link" data-user="${u.id}">Edit</button></div>`).join('')}</div>` : ''}`;
  $$('[data-range]').forEach((b) => b.addEventListener('click', () => (location.hash = `#/team?range=${b.dataset.range}`)));
  const userModal = (u) => {
    openModal(`<h2>${u ? 'Edit ' + esc(u.name) : 'Add person'}</h2><form id="userForm">
      <div class="field"><label>Name</label><input name="name" required value="${esc(u?.name || '')}"></div>
      ${u ? '' : '<div class="field"><label>Username</label><input name="username" required autocapitalize="none"></div>'}
      <div class="field"><label>Role</label><select name="role"><option value="hand">Hand</option><option value="owner" ${u?.role === 'owner' ? 'selected' : ''}>Owner</option></select></div>
      <div class="field"><label>${u ? 'Reset password / PIN (leave blank to keep)' : 'Password or PIN (4+ characters)'}</label>
        <input name="password" type="text" autocomplete="off" ${u ? '' : 'required minlength="4"'}></div>
      ${u ? `<label class="inline-check"><input type="checkbox" name="active" ${u.active ? 'checked' : ''}> Active (can log in)</label>` : ''}
      <div class="row" style="margin-top:12px"><button class="primary grow" type="submit">Save</button><button type="button" data-close>Cancel</button></div></form>`);
    $('#userForm').addEventListener('submit', guard(async (e) => {
      const d = formData(e.target);
      if (u) await api('PUT', `/users/${u.id}`, { ...d, active: Boolean(d.active) });
      else await api('POST', '/users', d);
      closeModal();
      toast('Saved');
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
      <div class="grid2">
        <div class="field"><label>Pay week starts</label><select name="week_start"><option value="0">Sunday</option><option value="1" ${s.week_start === '1' ? 'selected' : ''}>Monday</option></select></div>
        <div class="field"><label>Overtime after (hrs/week)</label><input type="number" name="overtime_hours" min="1" max="168" value="${esc(s.overtime_hours)}"></div>
      </div>
      <div class="field"><label>Payroll email (where reports go)</label><input type="email" name="payroll_email" value="${esc(s.payroll_email)}" placeholder="payroll@example.com"></div>
      <label class="inline-check"><input type="checkbox" name="payroll_auto_email" value="1" ${s.payroll_auto_email === '1' ? 'checked' : ''} ${S.emailEnabled ? '' : 'disabled'}>
        Auto-email last week's payroll every Monday morning</label>
      ${S.emailEnabled ? '' : '<p class="muted small">Email sending isn\'t set up on the server yet — see README "Emailing payroll". You can still download the CSV from the Time tab.</p>'}
      <h2>Map</h2>
      <p class="muted small">Where the map opens when there are no pins yet.</p>
      <div class="grid2">
        <div class="field"><label>Latitude</label><input name="map_lat" value="${esc(s.map_lat)}"></div>
        <div class="field"><label>Longitude</label><input name="map_lng" value="${esc(s.map_lng)}"></div>
      </div>
      <div class="field"><label>Zoom (1–20)</label><input type="number" name="map_zoom" min="1" max="20" value="${esc(s.map_zoom)}"></div>
      <button type="button" id="hereBtn" style="margin-bottom:12px">Use my current location</button>
      <button class="primary big" type="submit">Save settings</button>
    </form>`;
  const f = $('#setForm');
  $('#hereBtn').addEventListener('click', guard(async () => {
    const p = await getPosition();
    if (!p) throw new Error('Could not get your location');
    f.map_lat.value = p.lat.toFixed(6);
    f.map_lng.value = p.lng.toFixed(6);
  }));
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
  [/^\/map$/, viewMap, 'map'],
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
