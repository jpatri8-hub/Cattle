import { test } from 'node:test';
import assert from 'node:assert/strict';
import { summarize, payrollCsv, localDate, localHour, toCsv, payPeriodOf, previousPayPeriod } from '../src/payroll.js';

const e = (user_id, name, work_date, inH, outH, extra = {}) => ({
  user_id, name, work_date,
  clock_in: `${work_date}T${String(inH).padStart(2, '0')}:00:00.000Z`,
  clock_out: outH == null ? null : `${work_date}T${String(outH).padStart(2, '0')}:00:00.000Z`,
  ...extra,
});

test('pay periods are 1st-15th and 16th-end of month', () => {
  assert.deepEqual(payPeriodOf('2026-11-03'), { from: '2026-11-01', to: '2026-11-15' });
  assert.deepEqual(payPeriodOf('2026-11-15'), { from: '2026-11-01', to: '2026-11-15' });
  assert.deepEqual(payPeriodOf('2026-11-16'), { from: '2026-11-16', to: '2026-11-30' });
  assert.deepEqual(payPeriodOf('2026-12-31'), { from: '2026-12-16', to: '2026-12-31' });
  assert.deepEqual(payPeriodOf('2027-02-20'), { from: '2027-02-16', to: '2027-02-28' });
  assert.deepEqual(payPeriodOf('2028-02-20'), { from: '2028-02-16', to: '2028-02-29' });
});

test('previous pay period, including across months and years', () => {
  assert.deepEqual(previousPayPeriod('2026-11-20'), { from: '2026-11-01', to: '2026-11-15' });
  assert.deepEqual(previousPayPeriod('2026-11-01'), { from: '2026-10-16', to: '2026-10-31' });
  assert.deepEqual(previousPayPeriod('2027-01-16'), { from: '2027-01-01', to: '2027-01-15' });
  assert.deepEqual(previousPayPeriod('2027-01-05'), { from: '2026-12-16', to: '2026-12-31' });
});

test('totals are straight hours with no overtime split', () => {
  const entries = ['2026-11-02', '2026-11-03', '2026-11-04', '2026-11-05', '2026-11-06'].map((d) => e(1, 'Jake', d, 12, 22));
  const [s] = summarize(entries);
  assert.equal(s.total, 50);
  assert.equal('overtime' in s, false);
  assert.equal(Object.keys(s.days).length, 5);
});

test('counts edited and auto clocked-out punches', () => {
  const [s] = summarize([
    e(1, 'A', '2026-11-02', 10, 20, { edited: 1 }),
    e(1, 'A', '2026-11-03', 6, 20, { auto_closed: 1, needs_review: 1 }),
    e(1, 'A', '2026-11-04', 6, 20, { auto_closed: 1, edited: 1 }),
  ]);
  assert.equal(s.edited, 2);
  assert.equal(s.auto, 2);
  assert.equal(s.unconfirmed, 1);
});

test('PTO is counted separately from worked hours', () => {
  const entries = [
    e(1, 'Jake', '2026-11-02', 13, 22),
    { ...e(1, 'Jake', '2026-11-05', 12, 20), kind: 'pto', note: 'Vacation', edited: 1 },
  ];
  const [s] = summarize(entries);
  assert.equal(s.worked, 9);
  assert.equal(s.pto, 8);
  assert.equal(s.total, 17);
  assert.deepEqual(Object.keys(s.days), ['2026-11-02']);
  const csv = payrollCsv(entries, [s], { tz: 'America/Chicago', from: '2026-11-01', to: '2026-11-15' });
  assert.match(csv, /Jake,2026-11-05,PTO,,8\.00,PTO; Edited,Vacation/);
  assert.equal(s.edited, 0); // the owner changing PTO isn't a punch changed by hand
  assert.match(csv, /Jake,9\.00,8\.00,17\.00,0,0/);
});

test('open entry counts up to now', () => {
  const [s] = summarize([e(2, 'B', '2026-11-03', 12, null)], { nowIso: '2026-11-03T15:30:00.000Z' });
  assert.equal(s.total, 3.5);
  assert.equal(s.open, true);
});

test('local date and hour use ranch time zone', () => {
  // 03:00 UTC is still the previous evening in Chicago
  assert.equal(localDate('2026-11-04T03:00:00.000Z', 'America/Chicago'), '2026-11-03');
  assert.equal(localHour('2026-11-04T14:00:00.000Z', 'America/Chicago'), 8);
});

test('CSV escapes quotes/commas, neutralises formulas, and marks changes', () => {
  assert.equal(toCsv([['a,b', 'say "hi"', '=SUM(A1)']]), '"a,b","say ""hi""",\'=SUM(A1)\r\n');
  const entries = [
    e(1, 'Jake', '2026-11-03', 14, 23),
    e(1, 'Jake', '2026-11-04', 14, 23, { edited: 1, edited_by_name: 'Jake', note: 'Forgot to clock in' }),
    e(1, 'Jake', '2026-11-05', 2, 16, { auto_closed: 1, needs_review: 1 }),
  ];
  const csv = payrollCsv(entries, summarize(entries), { tz: 'America/Chicago', from: '2026-11-01', to: '2026-11-15' });
  assert.match(csv, /Jake,2026-11-03,8:00\sAM,5:00\sPM,9\.00,,/);
  assert.match(csv, /Edited by Jake,Forgot to clock in/);
  assert.match(csv, /Auto clock-out at 14h \(not yet confirmed\)/);
  assert.match(csv, /Jake,32\.00,0\.00,32\.00,1,1/);
  assert.doesNotMatch(csv, /[Oo]vertime/);
});
