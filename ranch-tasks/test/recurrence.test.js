import { test } from 'node:test';
import assert from 'node:assert/strict';
import { nextOccurrence, nextDueAfterCompletion, isOccurrence, describeRule } from '../public/recurrence.js';

const rule = (o) => ({ recur_interval: 1, recur_weekdays: '', ...o });

test('daily rolls forward from today when late', () => {
  const t = rule({ recur_type: 'daily', recur_anchor: '2026-10-01', due_date: '2026-10-10' });
  assert.equal(nextDueAfterCompletion(t, '2026-10-15'), '2026-10-16');
});

test('daily completed on time goes to tomorrow', () => {
  const t = rule({ recur_type: 'daily', recur_anchor: '2026-10-01', due_date: '2026-10-15' });
  assert.equal(nextDueAfterCompletion(t, '2026-10-15'), '2026-10-16');
});

test('completing early keeps the schedule', () => {
  const t = rule({ recur_type: 'weekly', recur_anchor: '2026-10-02', due_date: '2026-10-16' }); // Fridays
  assert.equal(nextDueAfterCompletion(t, '2026-10-14'), '2026-10-23');
});

test('every 3 days', () => {
  const t = rule({ recur_type: 'daily', recur_interval: 3, recur_anchor: '2026-10-01' });
  assert.equal(nextOccurrence(t, '2026-10-01'), '2026-10-04');
  assert.equal(nextOccurrence(t, '2026-10-05'), '2026-10-07');
});

test('weekdays Mon-Fri skips weekend', () => {
  const t = rule({ recur_type: 'weekly', recur_weekdays: '1,2,3,4,5', recur_anchor: '2026-10-12' });
  assert.equal(nextOccurrence(t, '2026-10-16'), '2026-10-19'); // Fri -> Mon
});

test('every 2 weeks on the anchor weekday', () => {
  const t = rule({ recur_type: 'weekly', recur_interval: 2, recur_anchor: '2026-10-05' });
  assert.equal(nextOccurrence(t, '2026-10-05'), '2026-10-19');
});

test('monthly on the 31st clamps to short months', () => {
  const t = rule({ recur_type: 'monthly', recur_anchor: '2026-01-31' });
  assert.equal(nextOccurrence(t, '2026-01-31'), '2026-02-28');
  assert.equal(nextOccurrence(t, '2026-02-28'), '2026-03-31');
});

test('twice a year (every 6 months)', () => {
  const t = rule({ recur_type: 'monthly', recur_interval: 6, recur_anchor: '2026-04-01' });
  assert.equal(nextOccurrence(t, '2026-04-01'), '2026-10-01');
  assert.equal(nextOccurrence(t, '2026-10-01'), '2027-04-01');
  assert.equal(describeRule(t), 'Twice a year');
});

test('yearly, completed late, goes to next year', () => {
  const t = rule({ recur_type: 'yearly', recur_anchor: '2026-04-01', due_date: '2026-04-01' });
  assert.equal(nextDueAfterCompletion(t, '2026-04-20'), '2027-04-01');
});

test('yearly on Feb 29', () => {
  const t = rule({ recur_type: 'yearly', recur_anchor: '2028-02-29' });
  assert.equal(nextOccurrence(t, '2028-02-29'), '2029-02-28');
});

test('nothing before the anchor; one-off has no next', () => {
  const t = rule({ recur_type: 'daily', recur_anchor: '2026-11-01' });
  assert.equal(isOccurrence(t, '2026-10-31'), false);
  assert.equal(nextOccurrence(t, '2026-10-01'), '2026-11-01');
  assert.equal(nextOccurrence(rule({ recur_type: 'none' }), '2026-10-01'), null);
});
