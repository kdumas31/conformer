// ui.js — DOM for the dock: clue tiles, pips, input + suggestions, the end card,
// and the two popovers (stats, archive). All text goes in via textContent;
// nothing is ever parsed as HTML except the constant icon markup below.

import { MAX_GUESSES } from './game.js';
import { mwText, hintByKey } from './hints.js';

const $ = (id) => document.getElementById(id);

function el(tag, cls, text) {
  const n = document.createElement(tag);
  if (cls) n.className = cls;
  if (text != null) n.textContent = text;
  return n;
}

// Constant markup only: the HTML parser puts <svg> in the SVG namespace for us.
function svg(paths, viewBox = '0 0 20 20') {
  const t = document.createElement('template');
  t.innerHTML = `<svg viewBox="${viewBox}" aria-hidden="true">${paths.map((d) => `<path d="${d}"/>`).join('')}</svg>`;
  return t.content.firstChild;
}

const ICON_COPY = ['M7 7h9v9H7z', 'M13 7V4H4v9h3'];
const ICON_CHECK = ['M4.5 10.5l3.5 3.5 7.5-8'];
const ICON_SPARK = ['M10 2.5v4M10 13.5v4M2.5 10h4M13.5 10h4M5 5l2.2 2.2M12.8 12.8 15 15M5 15l2.2-2.2M12.8 7.2 15 5'];
const ICON_NEXT = ['M4 10h11M11 5.5 15.5 10 11 14.5'];
const FLAME = 'M8.6 1.2c.3 2.2-.9 3.3-2 4.6C5.4 7.1 4.5 8.4 4.5 10.2 4.5 12.6 6 14.6 8 14.6s3.5-1.6 3.5-4c0-1.3-.5-2.3-1.1-3.1-.1.9-.6 1.6-1.3 1.8.6-2.6-.1-6.2-.5-8.1z';

const STATUS_WORD = { solved: 'Solved', failed: 'Missed', playing: 'In progress', unplayed: 'Not played yet' };

/** Formula tokens → text with real <sub> elements. */
export function formulaNode(parts, cls = 'formula') {
  const span = el('span', cls);
  for (const { t, sub } of parts) {
    span.appendChild(document.createTextNode(t));
    if (sub) span.appendChild(el('sub', null, sub));
  }
  return span;
}

/** A number that rolls up when it changes. */
export function setNumber(node, value, animate) {
  const text = String(value);
  if (node.textContent === text) return;
  node.textContent = text;
  if (animate) {
    node.classList.remove('tick');
    void node.offsetWidth; // restart the animation
    node.classList.add('tick');
  }
}

export function createUI() {
  const els = {
    app: $('app'),
    hints: $('hints'),
    tried: $('tried'),
    pips: $('pips'),
    field: $('field'),
    input: $('guess'),
    list: $('suggest'),
    note: $('note'),
    play: $('play'),
    result: $('result'),
    stats: $('stats'),
    statsBtn: $('btn-stats'),
    archive: $('archive'),
    archiveBtn: $('btn-archive'),
    todayBtn: $('btn-today'),
    streak: $('streak'),
    streakNum: $('streak-num'),
    meta: $('meta'),
    coach: $('coach'),
    announce: $('announce'),
  };

  // ---------------------------------------------------------------- screen reader
  let announceTimer = 0;
  function announce(text) {
    clearTimeout(announceTimer);
    els.announce.textContent = '';
    // a fresh text node after a tick makes repeated messages re-announce
    announceTimer = setTimeout(() => { els.announce.textContent = text; }, 60);
  }

  // ---------------------------------------------------------------- pips
  function makePips(container) {
    container.textContent = '';
    for (let i = 0; i < MAX_GUESSES; i++) {
      const p = el('span', 'pip');
      p.append(el('i', 'f'), el('i', 'b'));
      container.appendChild(p);
    }
  }
  makePips(els.pips);

  /** pipStates: from game.pips(). Newly turned pips flip with a small stagger. */
  function renderPips(pipStates, container = els.pips, animate = true) {
    let delay = 0;
    pipStates.forEach((p, i) => {
      const node = container.children[i];
      const r = p.result || (p.flipped ? 'open' : '');
      const on = !!r;
      const was = node.classList.contains('on');
      node.dataset.r = r;
      node.style.transition = animate ? '' : 'none'; // restored games appear already flipped
      node.style.transitionDelay = animate && on && !was ? `${delay}ms` : '0ms';
      if (animate && on && !was) {
        // after its flip, the pip that just filled pops once
        node.style.setProperty('--pd', `${delay + 480}ms`);
        node.classList.remove('pop');
        void node.offsetWidth;
        node.classList.add('pop');
        delay += 90;
      }
      node.classList.toggle('on', on);
    });
    if (!animate) {
      void container.offsetWidth;
      for (const node of container.children) node.style.transition = '';
    }
  }

  // ---------------------------------------------------------------- clue tiles
  function hintTile(h, i, animate) {
    const li = el('li', `hint h-${h.key}`);
    if (h.key === 'highlight') li.classList.add('glow');
    if (!animate) li.classList.add('still');
    else li.style.setProperty('--d', `${h.key === 'letters' ? 90 : 0}ms`); // 5 and 6 arrive together
    const cell = el('div', 'cell');
    cell.appendChild(el('span', 'k', h.label));
    const v = h.parts ? formulaNode(h.parts, 'v formula') : el('span', 'v', h.text);
    if (h.parts) v.setAttribute('aria-label', h.text);
    cell.appendChild(v);
    li.appendChild(cell);
    return li;
  }

  // Unrevealed tiles that can share a row with a real one get a quiet ghost (label
  // only, a hairline for the value). CSS shows a ghost only once a real tile sits in
  // its row (keyed by tile class and :has()), so a half-filled row never reads as an
  // empty slab. A ghost carries no clue text and is hidden from assistive tech.
  const GHOST_KEYS = new Set(['mw', 'era', 'letters']);
  function ghostTile(h) {
    const li = el('li', `hint slot h-${h.key}`);
    li.setAttribute('aria-hidden', 'true');
    const cell = el('div', 'cell');
    cell.append(el('span', 'k', h.label), el('span', 'v dash', '\u00a0'));
    li.appendChild(cell);
    return li;
  }
  const realTiles = () => els.hints.querySelectorAll('.hint:not(.slot)').length;

  /** Show the first `count` hints; only tiles that are new animate in. */
  function renderHints(hints, count, animate = true) {
    if (count < realTiles()) els.hints.textContent = '';
    const fresh = [];
    for (let i = realTiles(); i < count; i++) {
      const tile = hintTile(hints[i], i, animate);
      const ghost = els.hints.querySelector(`.slot.h-${hints[i].key}`);
      if (ghost) {
        // replaced in place: the row already has its height, so only the text fades up
        if (animate && getComputedStyle(ghost).display !== 'none') tile.classList.add('swap');
        ghost.replaceWith(tile);
      } else {
        els.hints.appendChild(tile);
      }
      fresh.push(hints[i]);
    }
    for (const h of hints.slice(count)) {
      if (GHOST_KEYS.has(h.key) && !els.hints.querySelector(`.h-${h.key}`)) els.hints.appendChild(ghostTile(h));
    }
    for (const g of els.hints.querySelectorAll('.slot')) g.classList.toggle('still', !animate);
    els.hints.dataset.count = String(count);
    if (animate && fresh.length) announce(fresh.map((h) => `${h.label}: ${h.text}`).join('. '));
  }

  function renderTried(names) {
    els.tried.textContent = '';
    names.forEach((n, i) => {
      if (i) els.tried.appendChild(el('i', 'dot'));
      els.tried.appendChild(el('s', null, n));
    });
    els.tried.hidden = !names.length;
  }

  // ---------------------------------------------------------------- note line
  let noteTimer = 0;
  let restingNote = '';
  function setRestingNote(text) {
    restingNote = text;
    if (!noteTimer) {
      els.note.textContent = text;
      els.note.classList.remove('bad');
    }
  }
  /** A passing, neutral message on the note line (resting text returns after a moment). */
  function noteOnce(text) {
    flashNote(text, false);
  }
  function flashNote(text, bad = true) {
    clearTimeout(noteTimer);
    els.note.textContent = text;
    els.note.classList.toggle('bad', bad);
    noteTimer = setTimeout(() => {
      noteTimer = 0;
      els.note.classList.remove('bad');
      els.note.textContent = restingNote;
    }, 1800);
  }

  function shake() {
    els.field.classList.remove('shake');
    void els.field.offsetWidth;
    els.field.classList.add('shake');
  }

  // Lock-in: an accepted guess presses the field and flashes its border (180 ms).
  let lockTimer = 0;
  function lockIn() {
    clearTimeout(lockTimer);
    els.field.classList.remove('lock');
    void els.field.offsetWidth;
    els.field.classList.add('lock');
    lockTimer = setTimeout(() => els.field.classList.remove('lock'), 180);
  }

  let shakeTimer = 0;
  function reject(reason) {
    shake();
    const msg = reason === 'duplicate' ? 'Already tried that one' : 'Not one I know — try another name';
    flashNote(msg);
    announce(msg);
    // One tracked timer clears the shake and its red edge (also under reduced motion,
    // which has no animation); a second rejection restarts it instead of cutting it short.
    clearTimeout(shakeTimer);
    shakeTimer = setTimeout(() => els.field.classList.remove('shake'), 700);
  }

  // ---------------------------------------------------------------- suggestions
  const list = { items: [], active: 0, moved: false };

  function renderSuggestions(items, query) {
    list.items = items;
    list.active = 0;
    list.moved = false;
    els.list.textContent = '';
    if (!items.length) {
      closeSuggestions();
      return;
    }
    const q = query.trim().toLowerCase();
    items.forEach((it, i) => {
      const li = el('li');
      li.id = `opt-${i}`;
      li.setAttribute('role', 'option');
      li.dataset.i = String(i);
      if (it.guessed) {
        li.classList.add('guessed');
        li.setAttribute('aria-disabled', 'true');
      }
      if (it.via) li.appendChild(el('span', 'via', `${it.via} →`));
      const name = el('span', 'name');
      // embolden the typed prefix when the canonical name starts with it
      if (!it.via && q && it.name.toLowerCase().startsWith(q)) {
        name.append(el('b', null, it.name.slice(0, q.length)), document.createTextNode(it.name.slice(q.length)));
      } else {
        name.textContent = it.name;
      }
      li.appendChild(name);
      if (it.guessed) li.appendChild(el('span', 'tag', 'tried'));
      els.list.appendChild(li);
    });
    els.list.hidden = false;
    els.input.setAttribute('aria-expanded', 'true');
    markActive();
  }

  function markActive() {
    [...els.list.children].forEach((li, i) => li.setAttribute('aria-selected', String(i === list.active)));
    els.input.setAttribute('aria-activedescendant', list.items.length ? `opt-${list.active}` : '');
  }

  function moveActive(delta) {
    if (!list.items.length) return;
    list.active = (list.active + delta + list.items.length) % list.items.length;
    list.moved = true;
    markActive();
  }

  function closeSuggestions() {
    els.list.hidden = true;
    els.input.setAttribute('aria-expanded', 'false');
    els.input.removeAttribute('aria-activedescendant');
  }

  const isOpen = () => !els.list.hidden;

  // ---------------------------------------------------------------- session reset
  /** Clear the dock for a new molecule (practice, archive day, back to today). */
  function reset() {
    els.hints.textContent = '';
    els.hints.dataset.count = '0';
    renderTried([]);
    makePips(els.pips);
    els.input.value = '';
    closeSuggestions();
    clearInterval(els.result._timer);
    els.result.textContent = '';
    els.result.hidden = true;
    els.play.hidden = false;
  }

  /** Header line: "№ 317 · Sat 14 Nov", plus a mode chip and a way back to today. */
  function setMeta({ mode, number, day }) {
    els.meta.textContent = '';
    if (mode === 'practice') {
      els.meta.appendChild(el('span', 'chip', 'Practice'));
      els.meta.appendChild(el('span', 'fine', 'never counted'));
    } else {
      els.meta.appendChild(document.createTextNode(`№ ${number} · ${day}`));
      if (mode === 'archive') els.meta.appendChild(el('span', 'chip', 'Archive'));
    }
    els.todayBtn.hidden = mode === 'daily';
    els.app.dataset.mode = mode;
  }

  // ---------------------------------------------------------------- end card
  function button(cls, icon, text) {
    const b = el('button', cls);
    b.type = 'button';
    if (icon) b.appendChild(svg(icon));
    b.appendChild(el('span', null, text));
    return b;
  }

  /** The answer, one letter at a time, rising in. */
  function answerNode(name) {
    const h = el('h2', 'answer');
    h.setAttribute('aria-label', name);
    [...name].forEach((ch, i) => {
      const s = el('span', ch === ' ' ? 'sp' : 'ch', ch === ' ' ? ' ' : ch);
      s.setAttribute('aria-hidden', 'true');
      s.style.setProperty('--i', String(i));
      h.appendChild(s);
    });
    return h;
  }

  function renderResult(o) {
    const { game, drug, hints, pipStates, streak, streakTicked, number, mode, nextIn } = o;
    const r = els.result;
    r.textContent = '';
    const solved = game.status === 'solved';
    r.classList.toggle('failed', !solved);
    r.classList.toggle('fresh', !!o.fresh);

    const eyebrow = el('p', 'eyebrow');
    const where = mode === 'practice' ? 'Practice' : mode === 'archive' ? `№ ${number} · Archive` : `№ ${number}`;
    if (solved) {
      const ex = game.hard ? ' · Expert' : '';
      eyebrow.append(el('span', 'ok', '✓ '), document.createTextNode(`Solved in ${game.guesses.length} · ${where}${ex}`));
    } else {
      eyebrow.textContent = `Not this time · ${where}`;
    }
    r.appendChild(eyebrow);
    r.appendChild(answerNode(drug.name));
    const cls = drug.hints?.class;
    if (cls) r.appendChild(el('p', 'cls', cls));

    const facts = el('div', 'facts');
    const f = hintByKey(hints, 'formula');
    if (f) facts.appendChild(formulaNode(f.parts));
    facts.appendChild(el('span', 'mw', mwText(drug.mw)));
    r.appendChild(facts);
    if (drug.iupac) r.appendChild(el('p', 'iupac', drug.iupac));

    const row = el('div', 'end-row');
    const mini = el('div', 'pips');
    mini.setAttribute('aria-hidden', 'true');
    makePips(mini);
    renderPips(pipStates, mini, false);
    row.appendChild(mini);
    if (mode === 'daily' && streak > 0) {
      const s = el('span', 'streak');
      s.title = 'Streak';
      s.setAttribute('aria-label', `Streak ${streak}`);
      const num = el('span', 'num', streakTicked ? String(Math.max(0, streak - 1)) : String(streak));
      s.append(svg([FLAME], '0 0 16 16'), num);
      row.appendChild(s);
      if (streakTicked) setTimeout(() => setNumber(num, streak, true), 900);
    }

    let primary;
    if (mode === 'practice') {
      primary = button('share', ICON_NEXT, 'Another molecule');
      primary.addEventListener('click', o.onAnother);
    } else {
      primary = button('share', ICON_COPY, 'Share');
      primary.addEventListener('click', async () => {
        const ok = await o.onShare();
        primary.replaceChildren(svg(ok ? ICON_CHECK : ICON_COPY), el('span', null, ok ? 'Copied' : 'Copy failed'));
        primary.classList.toggle('copied', ok);
        if (ok) announce('Result copied to the clipboard');
        clearTimeout(primary._t);
        primary._t = setTimeout(() => {
          primary.replaceChildren(svg(ICON_COPY), el('span', null, 'Share'));
          primary.classList.remove('copied');
        }, 1800);
      });
    }
    row.appendChild(primary);
    r.appendChild(row);

    // Optional local AI story (only when the server says it is available).
    if (o.story && solved) r.appendChild(storyBlock(o.story));

    if (mode === 'daily') {
      const next = el('p', 'next', `Next molecule in ${nextIn()}`);
      r.appendChild(next);
      clearInterval(r._timer);
      r._timer = setInterval(() => { next.textContent = `Next molecule in ${nextIn()}`; }, 30000);
    } else {
      const back = el('p', 'next');
      const link = button('link', null, mode === 'practice' ? 'Back to today’s molecule' : 'Back to today');
      link.addEventListener('click', o.onToday);
      back.appendChild(link);
      r.appendChild(back);
    }

    els.play.hidden = true;
    r.hidden = false;
    announce(solved ? `Solved in ${game.guesses.length}. The molecule is ${drug.name}.` : `Out of guesses. The molecule was ${drug.name}.`);
    return primary;
  }

  function storyBlock(fetchStory) {
    const wrap = el('div', 'story');
    const btn = button('ghost', ICON_SPARK, 'Tell me a story');
    const text = el('p', 'story-text');
    text.hidden = true;
    text.setAttribute('aria-live', 'polite');
    btn.addEventListener('click', async () => {
      btn.disabled = true;
      btn.classList.add('busy');
      btn.lastChild.textContent = 'Thinking…';
      const story = await fetchStory();
      btn.hidden = true;
      text.textContent = story || 'No story tonight.';
      text.classList.toggle('quiet', !story);
      text.hidden = false;
    });
    wrap.append(btn, text);
    return wrap;
  }

  // ---------------------------------------------------------------- popovers
  let openPop = null; // { node, btn, returnTo }

  function closePop({ restoreFocus = true } = {}) {
    if (!openPop) return;
    const { node, btn, returnTo } = openPop;
    node.hidden = true;
    btn.setAttribute('aria-expanded', 'false');
    openPop = null;
    if (restoreFocus && returnTo && document.contains(returnTo)) returnTo.focus({ preventScroll: true });
  }

  function showPop(node, btn, fill) {
    const same = openPop?.node === node;
    closePop({ restoreFocus: false });
    if (same) { btn.focus({ preventScroll: true }); return; }
    fill(node);
    node.hidden = false;
    btn.setAttribute('aria-expanded', 'true');
    openPop = { node, btn, returnTo: btn };
    (node.querySelector('[data-autofocus]') || node).focus({ preventScroll: true });
  }

  const popIsOpen = () => !!openPop;
  const popContains = (t) => !!openPop && (openPop.node.contains(t) || openPop.btn.contains(t));

  // ---------------------------------------------------------------- stats popover
  /** The Expert switch at the foot of the stats popover (shown even with no games played). */
  function expertRow({ expert, pending, onExpert }) {
    const wrap = el('div', 'expert');
    const b = el('button', 'switch');
    b.type = 'button';
    b.setAttribute('role', 'switch');
    b.id = 'expert-switch';
    const label = el('span', 'sw-label');
    label.append(el('b', null, 'Expert'), document.createTextNode(' · hide the class clue'));
    b.append(label, el('i', 'knob'));
    const sub = el('p', 'sw-note', 'Starts with your next molecule');
    const set = (on, waiting) => {
      b.setAttribute('aria-checked', String(on));
      sub.hidden = !waiting;
    };
    set(expert, pending);
    b.addEventListener('click', () => {
      const on = b.getAttribute('aria-checked') !== 'true';
      set(on, onExpert(on));
    });
    wrap.append(b, sub);
    return wrap;
  }

  function fillStats(p, data) {
    fillStatsBody(p, data);
    if (data.onExpert) p.appendChild(expertRow(data));
  }

  function fillStatsBody(p, { stats, streak, winRate, todayGuesses }) {
    p.textContent = '';
    p.appendChild(el('h3', null, 'Statistics'));
    const figs = el('div', 'figures');
    for (const [v, k] of [[stats.played, 'Played'], [winRate, 'Win %'], [streak, 'Streak'], [stats.maxStreak, 'Best']]) {
      const d = el('div');
      d.append(el('b', null, String(v)), el('span', null, k));
      figs.appendChild(d);
    }
    p.appendChild(figs);
    if (!stats.played) {
      p.appendChild(el('p', 'empty', 'Your first molecule awaits.'));
      return;
    }
    p.appendChild(el('p', 'dist-title', 'Guesses to solve'));
    const dist = el('div', 'dist');
    const max = Math.max(1, ...stats.dist);
    stats.dist.forEach((n, i) => {
      const r = el('div', 'r');
      r.appendChild(el('span', null, String(i + 1)));
      const bar = el('div', 'fill', String(n));
      bar.style.width = `${Math.max(8, (n / max) * 100)}%`;
      bar.style.animationDelay = `${i * 40}ms`;
      if (todayGuesses === i + 1) bar.classList.add('today');
      r.appendChild(bar);
      dist.appendChild(r);
    });
    p.appendChild(dist);
    p.appendChild(el('p', 'fine-print', 'Only each day’s own puzzle counts. Archive and practice never touch these numbers.'));
  }

  function toggleStats(open, data) {
    if (open === false || (open == null && openPop?.node === els.stats)) closePop();
    else showPop(els.stats, els.statsBtn, (p) => fillStats(p, data));
  }

  // ---------------------------------------------------------------- archive popover
  function fillArchive(p, { entries, current, onPick, onPractice }) {
    p.textContent = '';
    p.appendChild(el('h3', null, 'The last two weeks'));
    const grid = el('div', 'cal');
    const detail = el('p', 'cal-detail');
    const describe = (e) => {
      let s = `№ ${e.number} · ${e.day} — ${STATUS_WORD[e.status]}`;
      if (e.status === 'solved') s += ` in ${e.guesses}`;
      if (e.name) s += ` · ${e.name}`;
      return s;
    };
    const resting = 'Pick a day to play it. Results are kept, stats are not.';
    detail.textContent = resting;
    let first = null;
    for (const e of entries) {
      const b = el('button', `day s-${e.status}`);
      b.type = 'button';
      if (e.date === current) b.classList.add('current');
      const [wd, dn] = e.day.split(' ');
      b.append(el('span', 'wd', wd.slice(0, 2)), el('span', 'dn', dn), el('i', 'mark'));
      b.setAttribute('aria-label', describe(e));
      const show = () => { detail.textContent = describe(e); };
      b.addEventListener('mouseenter', show);
      b.addEventListener('focus', show);
      b.addEventListener('mouseleave', () => { detail.textContent = resting; });
      b.addEventListener('click', () => { closePop({ restoreFocus: false }); onPick(e.date); });
      grid.appendChild(b);
      first = first || b;
    }
    if (first) (grid.querySelector('.current') || grid.lastChild).dataset.autofocus = '';
    p.append(grid, detail);
    const practice = button('practice', null, '');
    practice.replaceChildren(el('b', null, 'Practice'), el('span', null, 'a random molecule · never counted'));
    practice.addEventListener('click', () => { closePop({ restoreFocus: false }); onPractice(); });
    p.appendChild(practice);
    if (!entries.length) detail.textContent = 'The archive fills in as the days go by.';
  }

  function toggleArchive(open, data) {
    if (open === false || (open == null && openPop?.node === els.archive)) closePop();
    else showPop(els.archive, els.archiveBtn, (p) => fillArchive(p, data));
  }

  // ---------------------------------------------------------------- header streak
  function setStreak(n, animate) {
    els.streak.hidden = n <= 0;
    setNumber(els.streakNum, n, animate);
    if (animate) {
      els.streak.classList.remove('bump');
      void els.streak.offsetWidth;
      els.streak.classList.add('bump');
    }
  }

  // ---------------------------------------------------------------- first-visit hint
  function showCoach(show) {
    els.coach.hidden = !show;
  }
  function dismissCoach() {
    if (els.coach.hidden || els.coach.classList.contains('gone')) return false;
    els.coach.classList.add('gone');
    setTimeout(() => { els.coach.hidden = true; }, 900);
    return true;
  }

  return {
    els,
    list,
    announce,
    renderPips,
    renderHints,
    renderTried,
    renderSuggestions,
    closeSuggestions,
    moveActive,
    isOpen,
    reject,
    lockIn,
    noteOnce,
    setRestingNote,
    reset,
    setMeta,
    renderResult,
    toggleStats,
    toggleArchive,
    closePop,
    popIsOpen,
    popContains,
    setStreak,
    showCoach,
    dismissCoach,
  };
}
