// Pure payroll / timesheet calculations (no DB access) so they can be tested.
import { addDays, parseDate } from '../public/recurrence.js';

export function localDate(iso, tz) {
  return new Intl.DateTimeFormat('en-CA', {
    timeZone: tz, year: 'numeric', month: '2-digit', day: '2-digit',
  }).format(new Date(iso));
}

export function localTime(iso, tz) {
  return new Intl.DateTimeFormat('en-US', {
    timeZone: tz, hour: 'numeric', minute: '2-digit',
  }).format(new Date(iso));
}

export function entryHours(entry, nowIso) {
  const end = entry.clock_out || nowIso;
  const ms = new Date(end) - new Date(entry.clock_in);
  return Math.max(0, ms / 3600000);
}

// Start of the payroll week containing `date` (weekStart: 0 = Sun, 1 = Mon).
export function weekStartOf(date, weekStart) {
  const dow = parseDate(date).getUTCDay();
  return addDays(date, -((dow - weekStart + 7) % 7));
}

const round2 = (x) => Math.round(x * 100) / 100;

// entries: [{ user_id, name, clock_in, clock_out, work_date, note }]
// Returns one summary per employee with weekly overtime split.
export function summarize(entries, { weekStart = 0, overtimeHours = 40, nowIso = new Date().toISOString() } = {}) {
  const byUser = new Map();
  for (const e of entries) {
    if (!byUser.has(e.user_id)) {
      byUser.set(e.user_id, { user_id: e.user_id, name: e.name, days: {}, weeks: {}, open: false });
    }
    const u = byUser.get(e.user_id);
    const h = entryHours(e, nowIso);
    if (!e.clock_out) u.open = true;
    u.days[e.work_date] = (u.days[e.work_date] || 0) + h;
    const wk = weekStartOf(e.work_date, weekStart);
    u.weeks[wk] = (u.weeks[wk] || 0) + h;
  }
  const out = [];
  for (const u of byUser.values()) {
    let total = 0;
    let overtime = 0;
    for (const h of Object.values(u.weeks)) {
      total += h;
      overtime += Math.max(0, h - overtimeHours);
    }
    for (const k of Object.keys(u.days)) u.days[k] = round2(u.days[k]);
    for (const k of Object.keys(u.weeks)) u.weeks[k] = round2(u.weeks[k]);
    out.push({
      ...u,
      total: round2(total),
      regular: round2(total - overtime),
      overtime: round2(overtime),
    });
  }
  out.sort((a, b) => a.name.localeCompare(b.name));
  return out;
}

function csvCell(v) {
  const s = v == null ? '' : String(v);
  // Neutralise spreadsheet formula injection, then quote if needed.
  const safe = /^[=+\-@\t\r]/.test(s) ? "'" + s : s;
  return /[",\n\r]/.test(safe) ? '"' + safe.replace(/"/g, '""') + '"' : safe;
}

export function toCsv(rows) {
  return rows.map((r) => r.map(csvCell).join(',')).join('\r\n') + '\r\n';
}

// Detailed timesheet: one row per punch, followed by per-employee totals.
export function payrollCsv(entries, summary, { tz, from, to, nowIso = new Date().toISOString() }) {
  const rows = [
    [`Payroll report ${from} to ${to}`],
    [],
    ['Employee', 'Date', 'Clock In', 'Clock Out', 'Hours', 'Note'],
  ];
  const sorted = [...entries].sort((a, b) => a.name.localeCompare(b.name) || a.clock_in.localeCompare(b.clock_in));
  for (const e of sorted) {
    rows.push([
      e.name,
      e.work_date,
      localTime(e.clock_in, tz),
      e.clock_out ? localTime(e.clock_out, tz) : 'STILL CLOCKED IN',
      entryHours(e, nowIso).toFixed(2),
      e.note || '',
    ]);
  }
  rows.push([], ['Employee', 'Regular Hours', 'Overtime Hours', 'Total Hours']);
  for (const s of summary) {
    rows.push([s.name, s.regular.toFixed(2), s.overtime.toFixed(2), s.total.toFixed(2)]);
  }
  return toCsv(rows);
}
