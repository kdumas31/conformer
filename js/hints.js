// hints.js — pure. Six hints per drug, in reveal order.
//
// Factual hints come only from PubChem-derived fields (formula, mw, counts,
// highlight). Curated class/era fall back to computed facts when null.
// Each hint: { key, label, text, parts?, atoms? }
//   parts: formula tokens [{ t, sub }] so the UI can render real <sub>.
//   atoms: atom indices to glow on the molecule (hint 5).

const HETERO = ['N', 'O', 'S', 'P', 'F', 'Cl', 'Br', 'I'];

const plural = (n, word) => `${n} ${word}${n === 1 ? '' : 's'}`;

export function formulaParts(formula) {
  const parts = [];
  const re = /([A-Z][a-z]?)(\d*)|([+-]\d*)/g;
  let m;
  while ((m = re.exec(formula))) {
    if (m[1]) parts.push({ t: m[1], sub: m[2] || '' });
    else if (m[3]) parts.push({ t: m[3], sub: '' });
  }
  return parts;
}

export function shapeText(counts) {
  const rings = counts.rings > 0 ? plural(counts.rings, 'ring') : 'no rings';
  return `${plural(counts.heavy, 'heavy atom')} · ${rings}`;
}

export function heteroText(counts) {
  const parts = HETERO.filter((el) => counts[el]).map((el) => `${counts[el]} ${el}`);
  return parts.length ? parts.join(' · ') : 'carbon and hydrogen only';
}

export function lettersText(name) {
  const words = String(name).split(/\s+/).filter(Boolean);
  const lens = words.map((w) => (w.match(/\p{L}/gu) || []).length).filter((n) => n > 0);
  const first = (String(name).match(/\p{L}/u) || ['?'])[0].toUpperCase();
  const total = lens.reduce((a, b) => a + b, 0);
  return `${first} · ${lens.join(' + ')} letter${total === 1 ? '' : 's'}`;
}

/** Molecular weight as shown everywhere (clue and end card). */
export const mwText = (mw) => `${Number(mw).toFixed(1)} g/mol`;

/** The hint with this key, or undefined (hints are looked up by key, never by position). */
export const hintByKey = (hints, key) => hints.find((h) => h.key === key);

const cap = (s) => (s ? s[0].toUpperCase() + s.slice(1) : s);

/** opts.hard (Expert) leaves out the class clue: five hints instead of six. */
export function buildHints(drug, { hard = false } = {}) {
  const { hints = {}, counts, highlight } = drug;
  const all = [
    hints.class
      ? { key: 'class', label: 'Class', text: hints.class }
      : { key: 'class', label: 'Shape', text: shapeText(counts) },
    { key: 'formula', label: 'Formula', text: drug.formula, parts: formulaParts(drug.formula) },
    { key: 'mw', label: 'Molecular weight', text: mwText(drug.mw) },
    hints.era
      ? { key: 'era', label: 'First US approval', text: hints.era }
      : { key: 'era', label: 'Heteroatoms', text: heteroText(counts) },
    {
      key: 'highlight',
      label: highlight?.atoms?.length ? 'Glowing' : 'On the molecule',
      text: cap(highlight?.label || heteroText(counts)),
      atoms: highlight?.atoms ?? [],
    },
    { key: 'letters', label: 'Name', text: lettersText(drug.name) },
  ];
  return hard ? all.filter((h) => h.key !== 'class') : all;
}
