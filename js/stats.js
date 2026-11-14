// stats.js — pure. Daily-mode stats (stored under conformer:v1:stats).
//   { played, wins, streak, maxStreak, lastWinDate, lastRecorded, dist[6] }
// A win the day after lastWinDate continues the streak; any other win sets it to 1.
// A fail sets it to 0. Recording the same date twice is a no-op (reload-safe).

import { addDays } from './puzzle.js';

export function emptyStats() {
  return { played: 0, wins: 0, streak: 0, maxStreak: 0, lastWinDate: null, lastRecorded: null, dist: [0, 0, 0, 0, 0, 0] };
}

/** Coerce anything loaded from storage into a valid stats object. */
export function sanitise(raw) {
  const s = emptyStats();
  if (!raw || typeof raw !== 'object') return s;
  for (const k of ['played', 'wins', 'streak', 'maxStreak']) {
    if (Number.isInteger(raw[k]) && raw[k] >= 0) s[k] = raw[k];
  }
  for (const k of ['lastWinDate', 'lastRecorded']) {
    if (typeof raw[k] === 'string' && /^\d{4}-\d{2}-\d{2}$/.test(raw[k])) s[k] = raw[k];
  }
  if (Array.isArray(raw.dist) && raw.dist.length === 6 && raw.dist.every((n) => Number.isInteger(n) && n >= 0)) {
    s.dist = raw.dist.slice();
  }
  return s;
}

/** result: { date, won, guesses } (guesses = 1..6 when won). Returns a new object. */
export function recordResult(stats, { date, won, guesses }) {
  if (stats.lastRecorded === date) return stats;
  const s = { ...stats, dist: stats.dist.slice(), played: stats.played + 1, lastRecorded: date };
  if (won) {
    s.wins += 1;
    s.streak = stats.lastWinDate && addDays(stats.lastWinDate, 1) === date ? stats.streak + 1 : 1;
    s.maxStreak = Math.max(s.maxStreak, s.streak);
    s.lastWinDate = date;
    if (guesses >= 1 && guesses <= 6) s.dist[guesses - 1] += 1;
  } else {
    s.streak = 0;
  }
  return s;
}

/** The streak to show today: 0 if the last win was before yesterday. */
export function displayStreak(stats, today) {
  if (!stats.lastWinDate || stats.streak === 0) return 0;
  return stats.lastWinDate === today || stats.lastWinDate === addDays(today, -1) ? stats.streak : 0;
}

export function winRate(stats) {
  return stats.played ? Math.round((100 * stats.wins) / stats.played) : 0;
}
