// Semi-monthly pay periods: the 1st–15th and the 16th–end of each month.
// Shared by the browser and the Worker. Dates are 'YYYY-MM-DD'.

const pad = (n) => String(n).padStart(2, '0');
const lastDayOfMonth = (y, m) => new Date(Date.UTC(y, m, 0)).getUTCDate(); // m is 1-based

// The pay period containing `date`.
export function payPeriodOf(date) {
  const [y, m, d] = date.split('-').map(Number);
  const ym = `${y}-${pad(m)}`;
  return d <= 15
    ? { from: `${ym}-01`, to: `${ym}-15` }
    : { from: `${ym}-16`, to: `${ym}-${pad(lastDayOfMonth(y, m))}` };
}

// The pay period just before the one containing `date`.
export function previousPayPeriod(date) {
  const [y, m, d] = date.split('-').map(Number);
  if (d > 15) return payPeriodOf(`${y}-${pad(m)}-01`);
  return m === 1 ? payPeriodOf(`${y - 1}-12-16`) : payPeriodOf(`${y}-${pad(m - 1)}-16`);
}
