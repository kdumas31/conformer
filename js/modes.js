// modes.js — pure. The three ways to play: today's daily, a past day from the
// archive, and unlimited practice. Only the daily ever touches stats.

import { addDays, dayIndex, formatDay, puzzleFor } from './puzzle.js';
import { restore } from './game.js';
import { recordResult } from './stats.js';

export const ARCHIVE_DAYS = 14;

/** The n days before today, oldest first, never before the puzzle epoch. */
export function archiveDates(today, n = ARCHIVE_DAYS) {
  const out = [];
  for (let k = n; k >= 1; k--) {
    const d = addDays(today, -k);
    if (dayIndex(d) >= 0) out.push(d);
  }
  return out;
}

export const isArchiveDate = (today, date, n = ARCHIVE_DAYS) => archiveDates(today, n).includes(date);

/**
 * One row per archive day: { date, number, day, status, guesses, name? }.
 * status: 'unplayed' | 'playing' | 'solved' | 'failed'. The drug name is only
 * included once that day is finished, so the archive never spoils a puzzle.
 */
export function archiveEntries(ids, today, getRaw, nameOf, n = ARCHIVE_DAYS) {
  return archiveDates(today, n).map((date) => {
    const { id, number } = puzzleFor(ids, date);
    const game = restore(getRaw(date), id);
    let status = 'unplayed';
    if (game && game.guesses.length) status = game.status === 'guessing' ? 'playing' : game.status;
    const row = { date, number, day: formatDay(date), status, guesses: game ? game.guesses.length : 0 };
    if (status === 'solved' || status === 'failed') row.name = nameOf(id);
    return row;
  });
}

/** Only today's daily counts toward streaks and the distribution. */
export const countsForStats = (mode) => mode === 'daily';

export function applyResult(stats, mode, result) {
  return countsForStats(mode) ? recordResult(stats, result) : stats;
}

/**
 * A random practice molecule: never today's, and not one of the archive days
 * (so practice cannot spoil a day you have not played yet) while others remain.
 */
export function pickPractice(ids, avoid = [], rand = Math.random) {
  const skip = new Set(avoid);
  let pool = ids.filter((id) => !skip.has(id));
  if (!pool.length) pool = ids.slice();
  return pool[Math.min(pool.length - 1, Math.floor(rand() * pool.length))];
}
