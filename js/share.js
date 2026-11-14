// share.js — pure. The copyable result card. Never contains the drug's name.
//
//   Conformer №317 3/6
//   🟥🟥🟩⬜⬜⬜ 🔥12
// Expert games get an asterisk on the score: 3/6*

import { pips, MAX_GUESSES } from './game.js';

const CELL = { miss: '🟥', hit: '🟩', none: '⬜' };

export function shareText(state, { number, streak = 0 } = {}) {
  const grid = pips(state).map((p) => CELL[p.result ?? 'none']).join('');
  const score = state.status === 'solved' ? `${state.guesses.length}/${MAX_GUESSES}` : `X/${MAX_GUESSES}`;
  const star = state.hard ? '*' : '';
  const fire = streak > 0 ? ` 🔥${streak}` : '';
  return `Conformer №${number} ${score}${star}\n${grid}${fire}`;
}
