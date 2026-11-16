// Date helpers. Indian markets run on IST (UTC+05:30, no DST).
// Trading-day logic here treats weekdays as sessions; exchange holiday
// calendars must come from the data provider in live mode.

const IST_OFFSET_MIN = 330;

export function nowInIst(now = new Date()) {
  return new Date(now.getTime() + IST_OFFSET_MIN * 60000);
}

/** ISO date (YYYY-MM-DD) of a Date treated as UTC calendar fields. */
export function isoDate(d) {
  return d.toISOString().slice(0, 10);
}

export function parseIsoDate(s) {
  const [y, m, d] = s.split('-').map(Number);
  return new Date(Date.UTC(y, m - 1, d));
}

export function addDays(iso, n) {
  const d = parseIsoDate(iso);
  d.setUTCDate(d.getUTCDate() + n);
  return isoDate(d);
}

export function isWeekday(iso) {
  const day = parseIsoDate(iso).getUTCDay();
  return day !== 0 && day !== 6;
}

export function daysBetween(a, b) {
  return Math.round((parseIsoDate(b) - parseIsoDate(a)) / 86400000);
}

/** Latest weekday session whose 15:30 IST close has passed. */
export function lastCompletedSession(now = new Date()) {
  const ist = nowInIst(now);
  let iso = isoDate(ist);
  const minutes = ist.getUTCHours() * 60 + ist.getUTCMinutes();
  if (!isWeekday(iso) || minutes < 15 * 60 + 30) iso = previousWeekday(iso);
  while (!isWeekday(iso)) iso = addDays(iso, -1);
  return iso;
}

export function previousWeekday(iso) {
  let d = addDays(iso, -1);
  while (!isWeekday(d)) d = addDays(d, -1);
  return d;
}

export function nextWeekday(iso) {
  let d = addDays(iso, 1);
  while (!isWeekday(d)) d = addDays(d, 1);
  return d;
}

/** n weekday sessions ending at (and including) endIso, oldest first. */
export function weekdaySessions(endIso, n) {
  const out = [endIso];
  let d = endIso;
  while (out.length < n) {
    d = previousWeekday(d);
    out.push(d);
  }
  return out.reverse();
}

/** IST timestamp string for a session date and HH:MM. */
export function istTimestamp(iso, hhmm = '15:30') {
  return `${iso}T${hhmm}:00+05:30`;
}

/** Indian fiscal-quarter label for a quarter ending on the given date. */
export function fiscalQuarterLabel(quarterEndIso) {
  const d = parseIsoDate(quarterEndIso);
  const month = d.getUTCMonth() + 1; // 3, 6, 9, 12
  const year = d.getUTCFullYear();
  const q = { 6: 1, 9: 2, 12: 3, 3: 4 }[month];
  const fy = month === 3 ? year : year + 1;
  return `Q${q} FY${String(fy).slice(2)}`;
}

/** Most recent calendar quarter-end at least `gapDays` before iso. */
export function quarterEndBefore(iso, gapDays = 15) {
  const limit = parseIsoDate(addDays(iso, -gapDays));
  let y = limit.getUTCFullYear();
  const candidates = [];
  for (const yy of [y, y - 1]) {
    for (const [m, dd] of [[12, 31], [9, 30], [6, 30], [3, 31]]) {
      candidates.push(new Date(Date.UTC(yy, m - 1, dd)));
    }
  }
  const qe = candidates.filter((c) => c <= limit).sort((a, b) => b - a)[0];
  return isoDate(qe);
}

export function previousQuarterEnd(qeIso) {
  const d = parseIsoDate(qeIso);
  const m = d.getUTCMonth() + 1;
  const y = d.getUTCFullYear();
  const map = { 3: [y - 1, 12, 31], 6: [y, 3, 31], 9: [y, 6, 30], 12: [y, 9, 30] };
  const [yy, mm, dd] = map[m];
  return isoDate(new Date(Date.UTC(yy, mm - 1, dd)));
}
