export function escapeHTML(str) {
  return String(str ?? '')
    .replace(/&/g, '&amp;')
    .replace(/</g, '&lt;')
    .replace(/>/g, '&gt;')
    .replace(/"/g, '&quot;')
    .replace(/'/g, '&#39;');
}

// The API returns local Eastern time without a timezone suffix in EstimatedDeparture.
// We compute the current Eastern UTC offset dynamically to handle EDT (-04:00) vs EST (-05:00).
function easternOffset() {
  const now    = new Date();
  const utcMs  = new Date(now.toLocaleString('en-US', { timeZone: 'UTC' }));
  const etMs   = new Date(now.toLocaleString('en-US', { timeZone: 'America/New_York' }));
  const mins   = Math.round((etMs - utcMs) / 60_000);
  const sign   = mins >= 0 ? '+' : '-';
  const abs    = Math.abs(mins);
  return `${sign}${String(Math.floor(abs / 60)).padStart(2, '0')}:${String(abs % 60).padStart(2, '0')}`;
}

export function toEastern(isoStr) {
  if (!isoStr) return null;
  const hasZone = /[-+]\d{2}:\d{2}$|Z$/.test(isoStr);
  return new Date(hasZone ? isoStr : isoStr + easternOffset());
}

export function minsUntil(isoStr) {
  const d = toEastern(isoStr);
  return d ? Math.round((d - Date.now()) / 60_000) : null;
}

export function fmtTime(isoStr) {
  const d = toEastern(isoStr);
  if (!d) return isoStr;
  return d.toLocaleTimeString('en-US', {
    hour: 'numeric', minute: '2-digit',
    timeZone: 'America/New_York',
  });
}

// DepartureTime from schedule is "HH:MM" (24-hour) — convert to 12-hour display
export function fmtHHMM(hhmm) {
  const [h, m] = hhmm.split(':').map(Number);
  if (isNaN(h) || isNaN(m)) return hhmm;
  const period = h >= 12 ? 'PM' : 'AM';
  return `${h % 12 || 12}:${String(m).padStart(2, '0')} ${period}`;
}
