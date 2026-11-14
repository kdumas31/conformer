// match.js — pure. Normalisation, exact lookup, and spoiler-free suggestions.
//
// The index never knows which drug is today's answer: suggest() takes no
// answer and no hints, so its output cannot leak them.

export const MAX_SUGGESTIONS = 6;

/** NFD, strip combining marks, lowercase, keep only [a-z0-9]. */
export function normalise(s) {
  return String(s ?? '')
    .normalize('NFD')
    .replace(/[̀-ͯ]/g, '')
    .toLowerCase()
    .replace(/[^a-z0-9]/g, '');
}

/**
 * Build the lookup index.
 *  - keys:    normalised name / alt / brand / alias → id (Enter accepts any)
 *  - entries: what suggestions are drawn from (names, alts, brands only)
 */
export function buildIndex(drugs) {
  const keys = new Map();
  const byId = new Map();
  const entries = [];
  const add = (k, id) => {
    if (k && !keys.has(k)) keys.set(k, id);
  };
  for (const d of drugs) {
    byId.set(d.id, d);
    add(normalise(d.name), d.id);
    for (const a of d.alt ?? []) add(normalise(a), d.id);
    for (const b of d.brands ?? []) add(normalise(b), d.id);
    for (const a of d.aliases ?? []) add(normalise(a), d.id);
    entries.push({
      id: d.id,
      name: d.name,
      nameKey: normalise(d.name),
      others: [...(d.brands ?? []), ...(d.alt ?? [])].map((label) => ({ label, key: normalise(label) })),
    });
  }
  // Fixed, answer-independent order: alphabetical by canonical name.
  entries.sort((a, b) => (a.nameKey < b.nameKey ? -1 : a.nameKey > b.nameKey ? 1 : 0));
  return { keys, byId, entries };
}

/** Exact normalised match on any key → id, else null. */
export function lookup(index, text) {
  const k = normalise(text);
  return (k && index.keys.get(k)) || null;
}

/**
 * Up to 6 suggestions. Rank: name prefix, then brand/alt prefix, then any substring.
 * Ties keep alphabetical order. `guessed` only greys entries; it never filters or reorders.
 * Returns [{id, name, via, guessed}], where `via` is the matched brand/alt label or null.
 */
export function suggest(index, text, guessed = new Set()) {
  const q = normalise(text);
  if (!q) return [];
  const tiers = [[], [], []];
  for (const e of index.entries) {
    if (e.nameKey.startsWith(q)) {
      tiers[0].push({ e, via: null });
      continue;
    }
    const pre = e.others.find((o) => o.key.startsWith(q));
    if (pre) {
      tiers[1].push({ e, via: pre.label });
      continue;
    }
    if (e.nameKey.includes(q)) {
      tiers[2].push({ e, via: null });
      continue;
    }
    const sub = e.others.find((o) => o.key.includes(q));
    if (sub) tiers[2].push({ e, via: sub.label });
  }
  return tiers
    .flat()
    .slice(0, MAX_SUGGESTIONS)
    .map(({ e, via }) => ({ id: e.id, name: e.name, via, guessed: guessed.has(e.id) }));
}

/**
 * What Enter submits. An item the player moved to with the arrows wins; then an
 * exact match on any key (name, alt, brand, alias); then the top suggestion.
 * Returns an id or null (→ rejected as unknown, at no cost).
 */
export function chooseGuess(index, text, items = [], active = 0, moved = false) {
  if (moved && items[active]) return items[active].id;
  return lookup(index, text) || (items[0] ? items[0].id : null);
}
