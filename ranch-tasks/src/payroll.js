// Pure payroll / timesheet calculations (no DB access) so they can be tested.
// Pay periods are semi-monthly (see public/payperiod.js).

export const AUTO_CLOCKOUT_HOURS = 14;

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

export function localHour(iso, tz) {
  return Number(new Intl.DateTimeFormat('en-US', { timeZone: tz, hour: 'numeric', hourCycle: 'h23' }).format(new Date(iso)));
}

export { payPeriodOf, previousPayPeriod } from '../public/payperiod.js';

export function entryHours(entry, nowIso) {
  const end = entry.clock_out || nowIso;
  const ms = new Date(end) - new Date(entry.clock_in);
  return Math.max(0, ms / 3600000);
}

const round2 = (x) => Math.round(x * 100) / 100;

// entries: [{ user_id, name, clock_in, clock_out, work_date, kind, edited, auto_closed, needs_review }]
// Returns one summary per employee: worked hours (by day), PTO hours, total,
// and how many punches were changed by hand or closed automatically.
export function summarize(entries, { nowIso = new Date().toISOString() } = {}) {
  const byUser = new Map();
  for (const e of entries) {
    if (!byUser.has(e.user_id)) {
      byUser.set(e.user_id, {
        user_id: e.user_id, name: e.name, days: {}, worked: 0, pto: 0, open: false, edited: 0, auto: 0, unconfirmed: 0,
      });
    }
    const u = byUser.get(e.user_id);
    const h = entryHours(e, nowIso);
    if (!e.clock_out) u.open = true;
    if (e.edited && e.kind !== 'pto') u.edited++;
    if (e.auto_closed) u.auto++;
    if (e.needs_review) u.unconfirmed++;
    if (e.kind === 'pto') {
      u.pto += h;
    } else {
      u.days[e.work_date] = (u.days[e.work_date] || 0) + h;
      u.worked += h;
    }
  }
  const out = [...byUser.values()].map((u) => {
    for (const k of Object.keys(u.days)) u.days[k] = round2(u.days[k]);
    return { ...u, worked: round2(u.worked), pto: round2(u.pto), total: round2(u.worked + u.pto) };
  });
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

export function changeLabel(e) {
  const parts = [];
  if (e.kind === 'pto') parts.push('PTO');
  if (e.auto_closed) parts.push(e.needs_review ? `Auto clock-out at ${AUTO_CLOCKOUT_HOURS}h (not yet confirmed)` : `Auto clock-out at ${AUTO_CLOCKOUT_HOURS}h`);
  if (e.edited) parts.push(e.edited_by_name ? `Edited by ${e.edited_by_name}` : 'Edited');
  return parts.join('; ');
}

// Detailed timesheet: one row per punch, followed by per-employee totals.
export function payrollCsv(entries, summary, { tz, from, to, nowIso = new Date().toISOString() }) {
  const rows = [
    [`Payroll report ${from} to ${to}`],
    [],
    ['Employee', 'Date', 'Clock In', 'Clock Out', 'Hours', 'Changes', 'Note'],
  ];
  const sorted = [...entries].sort((a, b) => a.name.localeCompare(b.name) || a.clock_in.localeCompare(b.clock_in));
  for (const e of sorted) {
    rows.push([
      e.name,
      e.work_date,
      e.kind === 'pto' ? 'PTO' : localTime(e.clock_in, tz),
      e.kind === 'pto' ? '' : e.clock_out ? localTime(e.clock_out, tz) : 'STILL CLOCKED IN',
      entryHours(e, nowIso).toFixed(2),
      changeLabel(e),
      e.note || '',
    ]);
  }
  rows.push([], ['Employee', 'Worked Hours', 'PTO Hours', 'Total Hours', 'Punches Changed By Hand', 'Auto Clock-outs']);
  for (const s of summary) {
    rows.push([s.name, s.worked.toFixed(2), s.pto.toFixed(2), s.total.toFixed(2), s.edited, s.auto]);
  }
  return toCsv(rows);
}
