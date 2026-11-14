// game.js — pure. The guess reducer and the pip rule.
//
// State is plain JSON (persisted per date as conformer:v1:game:<date>):
//   { v, status: 'idle'|'guessing'|'solved'|'failed', answer, guesses: [id], rejected }
// Six guesses; the six pips double as guess slots.
//   Miss k (1–4) flips pip k and reveals hint k.
//   Miss 5 flips pips 5 and 6 together, so the last guess has every hint.
//   Miss 6 → failed.
// Expert (hard: true) hides the class clue: five clues, miss k reveals clue k (k ≤ 5),
// so there is no double reveal on miss 5.

export const MAX_GUESSES = 6;
export const HINT_COUNT = 6;

export function newGame(answer, { hard = false } = {}) {
  return { v: 1, status: 'idle', answer, guesses: [], rejected: null, hard: hard === true };
}

export const isOver = (s) => s.status === 'solved' || s.status === 'failed';

export function misses(s) {
  return s.guesses.filter((g) => g !== s.answer).length;
}

/** How many hints are visible. */
export function revealedCount(s) {
  const m = misses(s);
  if (s.hard) return Math.min(m, HINT_COUNT - 1);
  return m >= MAX_GUESSES - 1 ? HINT_COUNT : m;
}

/**
 * Six pips: { flipped: hint i is revealed, result: 'miss' | 'hit' | null }.
 * `result` is the outcome of guess slot i.
 */
export function pips(s) {
  const shown = revealedCount(s);
  return Array.from({ length: MAX_GUESSES }, (_, i) => {
    const g = s.guesses[i];
    return {
      flipped: i < shown,
      result: g === undefined ? null : g === s.answer ? 'hit' : 'miss',
    };
  });
}

/**
 * reduce(state, event, ctx?) → state.
 *   { type: 'GUESS', id }  id null/unknown → rejected 'unknown' (no cost);
 *                          already guessed  → rejected 'duplicate' (no cost).
 *   { type: 'RESET' }      back to idle with the same answer (mid-game only).
 * ctx.known (optional Set of valid ids) marks ids outside the data as unknown.
 * Once solved or failed, every event returns the same state object.
 */
export function reduce(state, event, ctx = {}) {
  if (isOver(state)) return state;
  switch (event?.type) {
    case 'GUESS': {
      const id = event.id;
      if (!id || (ctx.known && !ctx.known.has(id))) return { ...state, rejected: 'unknown' };
      if (state.guesses.includes(id)) return { ...state, rejected: 'duplicate' };
      const guesses = [...state.guesses, id];
      let status = 'guessing';
      if (id === state.answer) status = 'solved';
      else if (guesses.length >= MAX_GUESSES) status = 'failed';
      return { ...state, status, guesses, rejected: null };
    }
    case 'RESET':
      return newGame(state.answer, { hard: state.hard });
    default:
      return state;
  }
}

/** Restore a persisted game, or null if it does not belong to this answer / is malformed. */
export function restore(raw, answer) {
  if (!raw || typeof raw !== 'object' || raw.answer !== answer || !Array.isArray(raw.guesses)) return null;
  let s = newGame(answer, { hard: raw.hard === true });
  for (const g of raw.guesses) s = reduce(s, { type: 'GUESS', id: g });
  return { ...s, rejected: null };
}

/** For each of the six hint rows, the missed guess that revealed it (or null). */
export function hintGuesses(s) {
  const m = s.guesses.filter((g) => g !== s.answer);
  return Array.from({ length: HINT_COUNT }, (_, i) => (i < MAX_GUESSES - 1 ? m[i] ?? null : null));
}
