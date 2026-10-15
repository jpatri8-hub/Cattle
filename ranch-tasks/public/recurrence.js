// Recurrence rules for tasks. All dates are 'YYYY-MM-DD' strings in ranch
// local time; arithmetic is done in UTC so DST never shifts a day.

const DAY_MS = 86400000;

export function parseDate(s) {
  const [y, m, d] = s.split('-').map(Number);
  return new Date(Date.UTC(y, m - 1, d));
}

export function formatDate(dt) {
  return dt.toISOString().slice(0, 10);
}

export function addDays(s, n) {
  return formatDate(new Date(parseDate(s).getTime() + n * DAY_MS));
}

function daysBetween(a, b) {
  return Math.round((parseDate(b) - parseDate(a)) / DAY_MS);
}

function daysInMonth(y, m0) {
  return new Date(Date.UTC(y, m0 + 1, 0)).getUTCDate();
}

export function parseWeekdays(str) {
  return String(str || '')
    .split(',')
    .map((x) => x.trim())
    .filter((x) => x !== '')
    .map(Number)
    .filter((n) => Number.isInteger(n) && n >= 0 && n <= 6);
}

// Is `date` an occurrence of the rule?
export function isOccurrence(rule, date) {
  const anchor = rule.recur_anchor;
  if (!anchor || date < anchor) return false;
  const n = Math.max(1, rule.recur_interval || 1);
  const a = parseDate(anchor);
  const d = parseDate(date);
  switch (rule.recur_type) {
    case 'daily':
      return daysBetween(anchor, date) % n === 0;
    case 'weekly': {
      let days = parseWeekdays(rule.recur_weekdays);
      if (days.length === 0) days = [a.getUTCDay()];
      if (!days.includes(d.getUTCDay())) return false;
      const anchorWeekStart = addDays(anchor, -a.getUTCDay());
      const weekIndex = Math.floor(daysBetween(anchorWeekStart, date) / 7);
      return weekIndex % n === 0;
    }
    case 'monthly': {
      const months = (d.getUTCFullYear() - a.getUTCFullYear()) * 12 + (d.getUTCMonth() - a.getUTCMonth());
      if (months % n !== 0) return false;
      const want = Math.min(a.getUTCDate(), daysInMonth(d.getUTCFullYear(), d.getUTCMonth()));
      return d.getUTCDate() === want;
    }
    case 'yearly': {
      const years = d.getUTCFullYear() - a.getUTCFullYear();
      if (years % n !== 0 || d.getUTCMonth() !== a.getUTCMonth()) return false;
      const want = Math.min(a.getUTCDate(), daysInMonth(d.getUTCFullYear(), d.getUTCMonth()));
      return d.getUTCDate() === want;
    }
    default:
      return false;
  }
}

// First occurrence strictly after `after`. Returns null for non-recurring.
export function nextOccurrence(rule, after) {
  if (!rule.recur_type || rule.recur_type === 'none' || !rule.recur_anchor) return null;
  const n = Math.max(1, rule.recur_interval || 1);
  // Never start before the anchor.
  let cur = after < rule.recur_anchor ? addDays(rule.recur_anchor, -1) : after;
  const limit = 366 * n + 62;
  for (let i = 0; i < limit; i++) {
    cur = addDays(cur, 1);
    if (isOccurrence(rule, cur)) return cur;
  }
  return null;
}

// When a recurring task is completed, it moves to the next occurrence after
// both its current due date and today, so missed days don't pile up.
export function nextDueAfterCompletion(task, today) {
  const base = task.due_date && task.due_date > today ? task.due_date : today;
  return nextOccurrence(task, base);
}

export function describeRule(rule) {
  const n = Math.max(1, rule.recur_interval || 1);
  const names = ['Sun', 'Mon', 'Tue', 'Wed', 'Thu', 'Fri', 'Sat'];
  switch (rule.recur_type) {
    case 'daily':
      return n === 1 ? 'Every day' : `Every ${n} days`;
    case 'weekly': {
      const days = parseWeekdays(rule.recur_weekdays);
      const on = days.length ? ' on ' + days.map((x) => names[x]).join(', ') : '';
      return (n === 1 ? 'Every week' : `Every ${n} weeks`) + on;
    }
    case 'monthly':
      if (n === 3) return 'Quarterly';
      if (n === 6) return 'Twice a year';
      return n === 1 ? 'Every month' : `Every ${n} months`;
    case 'yearly':
      return n === 1 ? 'Every year' : `Every ${n} years`;
    default:
      return 'One time';
  }
}
