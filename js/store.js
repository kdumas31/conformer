// store.js — localStorage wrapper. Nothing ever leaves the browser.
//
// Keys:  conformer:v1:game:<date>   per-day game state
//        conformer:v1:stats         daily stats
//        conformer:v1:theme         'dark' | 'light' (absent = follow system)
//        conformer:v1:practice      the current practice game (never counted)
//        conformer:v1:seen          1 once the first-visit hint has been dismissed
//        conformer:v1:expert        true when Expert (no class clue) is on; new games take it
// readOnly (shot mode) turns every write into a no-op.

const PREFIX = 'conformer:v1:';

export const keys = {
  game: (date) => `${PREFIX}game:${date}`,
  stats: `${PREFIX}stats`,
  theme: `${PREFIX}theme`,
  practice: `${PREFIX}practice`,
  seen: `${PREFIX}seen`,
  expert: `${PREFIX}expert`,
};

export function createStore({ readOnly = false, backend } = {}) {
  let ls = backend;
  if (!ls) {
    try {
      ls = window.localStorage;
    } catch {
      ls = null;
    }
  }
  return {
    readOnly,
    get(key) {
      try {
        const raw = ls?.getItem(key);
        return raw == null ? null : JSON.parse(raw);
      } catch {
        return null;
      }
    },
    set(key, value) {
      if (readOnly) return;
      try {
        ls?.setItem(key, JSON.stringify(value));
      } catch {
        /* quota or privacy mode: play on without saving */
      }
    },
    remove(key) {
      if (readOnly) return;
      try {
        ls?.removeItem(key);
      } catch {
        /* ignore */
      }
    },
  };
}
