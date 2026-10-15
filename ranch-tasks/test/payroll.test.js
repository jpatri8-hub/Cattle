import { test } from 'node:test';
import assert from 'node:assert/strict';
import { summarize, payrollCsv, localDate, weekStartOf, toCsv } from '../src/payroll.js';

const e = (user_id, name, work_date, inH, outH) => ({
  user_id, name, work_date,
  clock_in: `${work_date}T${String(inH).padStart(2, '0')}:00:00.000Z`,
  clock_out: outH == null ? null : `${work_date}T${String(outH).padStart(2, '0')}:00:00.000Z`,
});

test('weekly overtime split', () => {
  // 5 x 9h = 45h in one Sun-start week -> 5h OT
  const entries = ['2026-10-12', '2026-10-13', '2026-10-14', '2026-10-15', '2026-10-16'].map((d) => e(1, 'Jake', d, 12, 21));
  const [s] = summarize(entries, { weekStart: 0, overtimeHours: 40 });
  assert.equal(s.total, 45);
  assert.equal(s.overtime, 5);
  assert.equal(s.regular, 40);
});

test('overtime is per week, not per range', () => {
  const entries = [
    ...['2026-10-05', '2026-10-06', '2026-10-07'].map((d) => e(1, 'A', d, 10, 22)), // 36h week 1
    ...['2026-10-12', '2026-10-13', '2026-10-14'].map((d) => e(1, 'A', d, 10, 22)), // 36h week 2
  ];
  const [s] = summarize(entries, { weekStart: 0, overtimeHours: 40 });
  assert.equal(s.total, 72);
  assert.equal(s.overtime, 0);
});

test('open entry counts up to now', () => {
  const [s] = summarize([e(2, 'B', '2026-10-15', 12, null)], { nowIso: '2026-10-15T15:30:00.000Z' });
  assert.equal(s.total, 3.5);
  assert.equal(s.open, true);
});

test('week start Monday vs Sunday', () => {
  assert.equal(weekStartOf('2026-10-15', 0), '2026-10-11');
  assert.equal(weekStartOf('2026-10-15', 1), '2026-10-12');
  assert.equal(weekStartOf('2026-10-11', 1), '2026-10-05');
});

test('local date uses ranch time zone', () => {
  // 03:00 UTC is still the previous evening in Chicago
  assert.equal(localDate('2026-10-16T03:00:00.000Z', 'America/Chicago'), '2026-10-15');
});

test('CSV escapes quotes/commas and neutralises formulas', () => {
  assert.equal(toCsv([['a,b', 'say "hi"', '=SUM(A1)']]), '"a,b","say ""hi""",\'=SUM(A1)\r\n');
  const entries = [e(1, 'Jake', '2026-10-15', 13, 22)];
  const csv = payrollCsv(entries, summarize(entries), { tz: 'America/Chicago', from: '2026-10-11', to: '2026-10-17' });
  assert.match(csv, /Jake,2026-10-15,8:00\sAM,5:00\sPM,9\.00/);
  assert.match(csv, /Jake,9\.00,0\.00,9\.00/);
});
