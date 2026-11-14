// puzzle.js — pure. Deterministic daily puzzle from a local date string.
//
// Never reads the clock: every function takes 'YYYY-MM-DD'. The caller turns
// "now" into a string once, with toDateString(new Date()).

export const EPOCH = '2026-01-01';
const DAY_MS = 86400000;
const SEED_BASE = 0xc0f0;

const DATE_RE = /^(\d{4})-(\d{2})-(\d{2})$/;

export function parseDate(dateStr) {
  const m = DATE_RE.exec(String(dateStr));
  if (!m) throw new Error(`bad date: ${dateStr}`);
  const y = +m[1], mo = +m[2], d = +m[3];
  const t = Date.UTC(y, mo - 1, d);
  const back = new Date(t);
  if (back.getUTCFullYear() !== y || back.getUTCMonth() !== mo - 1 || back.getUTCDate() !== d) {
    throw new Error(`bad date: ${dateStr}`);
  }
  return [y, mo, d];
}

function utc(dateStr) {
  const [y, m, d] = parseDate(dateStr);
  return Date.UTC(y, m - 1, d);
}

const pad = (n, w = 2) => String(n).padStart(w, '0');

/** Local calendar date of a Date object → 'YYYY-MM-DD'. */
export function toDateString(date) {
  return `${pad(date.getFullYear(), 4)}-${pad(date.getMonth() + 1)}-${pad(date.getDate())}`;
}

/** Whole days from EPOCH (UTC arithmetic on the local y/m/d, so DST cannot shift it). */
export function dayIndex(dateStr) {
  return Math.round((utc(dateStr) - utc(EPOCH)) / DAY_MS);
}

export function puzzleNumber(dateStr) {
  return dayIndex(dateStr) + 1;
}

export function addDays(dateStr, n) {
  const t = new Date(utc(dateStr) + n * DAY_MS);
  return `${pad(t.getUTCFullYear(), 4)}-${pad(t.getUTCMonth() + 1)}-${pad(t.getUTCDate())}`;
}

const WEEKDAYS = ['Sun', 'Mon', 'Tue', 'Wed', 'Thu', 'Fri', 'Sat'];
const MONTHS = ['Jan', 'Feb', 'Mar', 'Apr', 'May', 'Jun', 'Jul', 'Aug', 'Sep', 'Oct', 'Nov', 'Dec'];

/** 'Fri 13 Nov' */
export function formatDay(dateStr) {
  const [, m, d] = parseDate(dateStr);
  const wd = new Date(utc(dateStr)).getUTCDay();
  return `${WEEKDAYS[wd]} ${d} ${MONTHS[m - 1]}`;
}

/** mulberry32 PRNG: seed → () => float in [0, 1). */
export function mulberry32(seed) {
  let a = seed >>> 0;
  return function next() {
    a = (a + 0x6d2b79f5) >>> 0;
    let t = a;
    t = Math.imul(t ^ (t >>> 15), t | 1);
    t ^= t + Math.imul(t ^ (t >>> 7), t | 61);
    return ((t ^ (t >>> 14)) >>> 0) / 4294967296;
  };
}

function shuffled(sortedIds, cycle) {
  const a = sortedIds.slice();
  const rnd = mulberry32(SEED_BASE + cycle);
  for (let i = a.length - 1; i > 0; i--) {
    const j = Math.floor(rnd() * (i + 1));
    [a[i], a[j]] = [a[j], a[i]];
  }
  return a;
}

const sortIds = (ids) => [...ids].sort();

/** Play order for one cycle. The first drug never repeats the previous cycle's last. */
export function cycleOrder(ids, cycle) {
  const sorted = sortIds(ids);
  const order = shuffled(sorted, cycle);
  if (order.length > 2) {
    const prev = shuffled(sorted, cycle - 1);
    if (order[0] === prev[prev.length - 1]) [order[0], order[1]] = [order[1], order[0]];
  }
  return order;
}

/** The puzzle for a date: { id, number, dayIndex, cycle, position }. */
export function puzzleFor(ids, dateStr) {
  const n = ids.length;
  if (!n) throw new Error('no drugs');
  const di = dayIndex(dateStr);
  const cycle = Math.floor(di / n);
  const position = di - cycle * n; // non-negative even before the epoch
  return { id: cycleOrder(ids, cycle)[position], number: di + 1, dayIndex: di, cycle, position };
}

/** Milliseconds → "6 h 12 m", "12 m", "under a minute". */
export function formatCountdown(ms) {
  const mins = Math.floor(Math.max(0, ms) / 60000);
  if (mins < 1) return 'under a minute';
  const h = Math.floor(mins / 60), m = mins % 60;
  return h ? `${h} h ${String(m).padStart(2, '0')} m` : `${m} m`;
}
