// main.js — entry point. Loads the data, opens today's molecule, wires the pieces.
//
// Sessions: 'daily' (today, counts toward stats), 'archive' (one of the last 14
// days; results kept, stats untouched) and 'practice' (random, never counted).
// Switching sessions swaps the molecule in place; nothing reloads.
//
// Query params:
//   ?frame=390                         constrain #app to a phone width (any mode)
//   ?date=YYYY-MM-DD                   open that archive day (must be within the last 14)
// Shot mode (screenshots; storage-free, still frame):
//   ?shot=1&date=YYYY-MM-DD&theme=dark|light&demo=solved|failed|playing
//   &h=1 (hydrogens) &drug=<id> &bench=1 [&burst=1] &stats=1 &archive=1 &mode=practice|archive &ai=1
//   &expert=1 (Expert: no class clue)

import { buildIndex, suggest, chooseGuess } from './match.js';
import { puzzleFor, toDateString, formatDay, formatCountdown, parseDate } from './puzzle.js';
import { newGame, reduce, restore, pips, revealedCount, isOver, hintGuesses, MAX_GUESSES } from './game.js';
import { buildHints, hintByKey } from './hints.js';
import { sanitise, displayStreak, winRate, emptyStats } from './stats.js';
import { shareText } from './share.js';
import { createStore, keys } from './store.js';
import { createRenderer } from './renderer.js';
import { createUI } from './ui.js';
import { archiveDates, archiveEntries, isArchiveDate, applyResult, pickPractice } from './modes.js';

const params = new URLSearchParams(location.search);
const SHOT = params.get('shot') === '1';
const store = createStore({ readOnly: SHOT });
const root = document.documentElement;
const app = document.getElementById('app');
const canvas = document.getElementById('stage');

if (SHOT) root.classList.add('shot');

// A phone-width frame inside the fixed 1440×900 screenshot window.
{
  const fw = Number(params.get('frame'));
  if (fw >= 280 && fw <= 1200) {
    app.classList.add('framed');
    app.style.setProperty('--frame', `${Math.round(fw)}px`);
  }
}

// ---------------------------------------------------------------- theme
const sysDark = matchMedia('(prefers-color-scheme: dark)');
const systemTheme = () => (sysDark.matches ? 'dark' : 'light');
const effectiveTheme = () => root.dataset.theme || systemTheme();

{
  const forced = SHOT ? params.get('theme') : store.get(keys.theme);
  if (forced === 'dark' || forced === 'light') root.dataset.theme = forced;
}

// ---------------------------------------------------------------- date
function validDate(s) {
  try {
    parseDate(s);
    return true;
  } catch {
    return false;
  }
}
const today = SHOT && validDate(params.get('date')) ? params.get('date') : toDateString(new Date());

// ---------------------------------------------------------------- data
function validData(data) {
  return (
    data && Array.isArray(data.drugs) && data.drugs.length > 0 &&
    data.drugs.every((d) => d && typeof d.id === 'string' && Array.isArray(d.atoms) && d.atoms.length && Array.isArray(d.bonds))
  );
}

function loadSync() {
  // Shot mode only: headless Chrome screenshots at `load`, so finish before it.
  const xhr = new XMLHttpRequest();
  xhr.open('GET', 'data/drugs.json', false);
  xhr.send();
  return xhr.status === 200 ? JSON.parse(xhr.responseText) : null;
}

async function loadAsync() {
  const res = await fetch('data/drugs.json', { cache: 'no-cache' });
  if (!res.ok) return null;
  return res.json();
}

function showError() {
  app.dataset.state = 'error';
}

// Hosted build: the optional local-AI story needs the Mac, so it is removed here.
async function aiAvailable() { return false; }
async function fetchStory() { return ''; }

// ---------------------------------------------------------------- game
function start(data, ai = false) {
  const drugs = data.drugs;
  const ids = drugs.map((d) => d.id);
  const known = new Set(ids);
  const index = buildIndex(drugs);
  const byId = index.byId;
  const nameOf = (id) => byId.get(id)?.name ?? id;
  const daily = puzzleFor(ids, today);

  const ui = createUI();
  const renderer = createRenderer(canvas, { still: SHOT });
  renderer.setTheme(effectiveTheme());
  renderer.resize();

  let stats = SHOT ? emptyStats() : sanitise(store.get(keys.stats));
  let expert = SHOT ? params.get('expert') === '1' : store.get(keys.expert) === true;
  ui.setStreak(displayStreak(stats, today), false); // a running streak shows before today's solve

  // The current session.
  let S = null; // { mode, date, number, drug, hints, key, game }

  function persist() {
    if (S.mode === 'practice') store.set(keys.practice, snapshot(S.game));
    else store.set(S.key, snapshot(S.game));
  }
  const snapshot = (g) => ({ v: g.v, answer: g.answer, guesses: g.guesses, status: g.status, ...(g.hard ? { hard: true } : {}) });

  function restingNote() {
    const left = MAX_GUESSES - S.game.guesses.length;
    const where = S.mode === 'practice' ? 'Practice · ' : S.mode === 'archive' ? `Archive № ${S.number} · ` : '';
    if (!S.game.guesses.length) {
      if (S.mode === 'practice') return 'Practice · six guesses, nothing at stake';
      return `${where}Six guesses · each miss reveals a clue`;
    }
    if (left === 1) return `${where}Last guess · every clue is showing`;
    return `${where}${left} guesses left`;
  }

  function syncPlay(animate) {
    const shown = revealedCount(S.game);
    ui.renderHints(S.hints, shown, animate);
    ui.renderTried(hintGuesses(S.game).filter(Boolean).map(nameOf));
    ui.renderPips(pips(S.game), undefined, animate);
    ui.setRestingNote(restingNote());
    const lit = hintByKey(S.hints.slice(0, shown), 'highlight');
    const glow = lit && !isOver(S.game) ? lit.atoms : null;
    renderer.setHighlight(glow);
  }

  /** Open a session. mode: 'daily' | 'archive' | 'practice'. */
  function open(mode, { date = today, fresh = false, demo = null, swap = true } = {}) {
    let drug;
    let game = null;
    let number = 0;
    let key = null;
    if (mode === 'practice') {
      const saved = SHOT ? null : store.get(keys.practice);
      const savedDrug = saved && byId.get(saved.answer);
      const avoid = [daily.id, ...archiveDates(today).map((d) => puzzleFor(ids, d).id)];
      if (!fresh && savedDrug && saved.answer !== daily.id) {
        game = restore(saved, saved.answer);
        if (game && isOver(game)) game = null; // finished: start a new one
      }
      if (!game) {
        const pick = SHOT && byId.has(params.get('drug')) ? params.get('drug') : pickPractice(ids, avoid, SHOT ? () => 0.42 : Math.random);
        game = newGame(pick, { hard: expert });
      }
      drug = byId.get(game.answer);
    } else {
      const p = puzzleFor(ids, date);
      const override = SHOT && byId.has(params.get('drug')) ? params.get('drug') : null;
      drug = byId.get(override || p.id);
      number = p.number;
      key = keys.game(date);
      game = SHOT ? null : restore(store.get(key), drug.id);
      if (!game) game = newGame(drug.id, { hard: expert });
    }
    if (demo) game = demoGame(demo, drug.id, ids, expert);

    S = { mode, date, number, drug, hints: buildHints(drug, { hard: game.hard }), key, game };
    if (mode === 'practice' && !SHOT) persist();

    ui.reset();
    ui.closePop({ restoreFocus: false });
    ui.setMeta({ mode, number, day: formatDay(date) });
    const heavy = drug.counts?.heavy ?? '';
    canvas.setAttribute('aria-label', `3D structure, ${heavy} heavy atoms. Drag or use the arrow keys to turn it; scroll to zoom.`);
    if (swap) renderer.swapMolecule(drug);
    else renderer.setMolecule(drug);
    syncPlay(false);
    if (isOver(S.game)) finish(false);
    afterLayout(swap);
    if (swap) ui.announce(mode === 'practice' ? 'Practice molecule. Type to guess.' : `Puzzle number ${number}, ${formatDay(date)}. Type to guess.`);
  }

  async function share() {
    const streak = S.mode === 'daily' ? displayStreak(stats, today) : 0;
    const text = shareText(S.game, { number: S.number, streak });
    try {
      await navigator.clipboard.writeText(text);
      return true;
    } catch {
      // Fallback for browsers without the async clipboard API.
      const ta = document.createElement('textarea');
      ta.value = text;
      ta.setAttribute('readonly', '');
      ta.style.cssText = 'position:fixed;opacity:0;pointer-events:none';
      document.body.appendChild(ta);
      ta.select();
      let ok = false;
      try { ok = document.execCommand('copy'); } catch { ok = false; }
      ta.remove();
      return ok;
    }
  }

  function nextIn() {
    // Shot mode freezes the clock at 6am on the shot date, so the frame is reproducible.
    const now = SHOT ? new Date(`${today}T06:00:00`) : new Date();
    const midnight = new Date(now.getFullYear(), now.getMonth(), now.getDate() + 1);
    return formatCountdown(midnight - now);
  }

  function finish(fresh) {
    const before = displayStreak(stats, today);
    if (!SHOT) {
      const next = applyResult(stats, S.mode, { date: S.date, won: S.game.status === 'solved', guesses: S.game.guesses.length });
      if (next !== stats) {
        stats = next;
        store.set(keys.stats, stats);
      }
    }
    const streak = displayStreak(stats, today);
    renderer.setHighlight(null);
    ui.closeSuggestions();
    ui.els.input.blur();
    const drugId = S.drug.id;
    const primary = ui.renderResult({
      game: S.game, drug: S.drug, hints: S.hints, pipStates: pips(S.game), streak, number: S.number,
      mode: S.mode, fresh, streakTicked: fresh && streak > before, nextIn,
      onShare: share,
      onAnother: () => open('practice', { fresh: true }),
      onToday: () => open('daily'),
      story: ai ? () => fetchStory(drugId) : null,
    });
    if (fresh) primary.focus({ preventScroll: true }); // keyboard flow: Enter shares / plays on
    if (S.mode === 'daily') ui.setStreak(streak, fresh && streak !== before);
    if (fresh && S.game.status === 'solved') {
      renderer.celebrate();
      app.dataset.solved = 'fresh'; // the wordmark's little molecule spins along
      setTimeout(() => { delete app.dataset.solved; }, 2800);
    }
    ui.dismissCoach();
    afterLayout();
  }

  function submit(id) {
    const next = reduce(S.game, { type: 'GUESS', id }, { known });
    if (next === S.game) return;
    if (next.rejected) {
      ui.reject(next.rejected);
      return;
    }
    S.game = next;
    persist();
    ui.lockIn();
    ui.els.input.value = '';
    ui.closeSuggestions();
    syncPlay(true);
    const sess = S;
    if (isOver(S.game)) setTimeout(() => { if (S === sess) finish(true); }, S.game.status === 'solved' ? 380 : 650);
  }

  // --- first-visit hint: "drag to spin · type to guess"
  const coachWanted = SHOT ? !params.get('demo') && !params.get('mode') : !store.get(keys.seen);
  ui.showCoach(coachWanted);
  function firstTouch() {
    if (ui.dismissCoach()) store.set(keys.seen, 1);
  }
  canvas.addEventListener('pointerdown', firstTouch);
  canvas.addEventListener('wheel', firstTouch, { passive: true });

  // --- input & suggestions
  const input = ui.els.input;
  function refreshSuggestions() {
    ui.renderSuggestions(suggest(index, input.value, new Set(S.game.guesses)), input.value);
  }
  input.addEventListener('input', () => { firstTouch(); refreshSuggestions(); });
  input.addEventListener('focus', () => { if (input.value) refreshSuggestions(); });
  input.addEventListener('blur', () => setTimeout(() => ui.closeSuggestions(), 120));
  // Arrow keys turn the molecule when there is nothing to navigate: an empty input with
  // the list closed, or focus on the page itself or the canvas.
  const ARROWS = { ArrowLeft: [-1, 0], ArrowRight: [1, 0], ArrowUp: [0, -1], ArrowDown: [0, 1] };
  function arrowTurn(e) {
    const d = ARROWS[e.key];
    if (!d || e.metaKey || e.ctrlKey || e.altKey || e.shiftKey) return false;
    renderer.nudge(d[0], d[1]);
    firstTouch();
    e.preventDefault();
    return true;
  }
  input.addEventListener('keydown', (e) => {
    if (ARROWS[e.key] && !input.value && !ui.isOpen()) {
      arrowTurn(e);
      return;
    }
    if (e.key === 'ArrowUp' || e.key === 'ArrowDown') {
      if (!ui.isOpen()) refreshSuggestions();
      ui.moveActive(e.key === 'ArrowDown' ? 1 : -1);
      e.preventDefault();
    } else if (e.key === 'Enter') {
      e.preventDefault();
      if (!input.value.trim()) return;
      const { items, active, moved } = ui.list;
      submit(chooseGuess(index, input.value, ui.isOpen() ? items : [], active, moved));
    } else if (e.key === 'Escape') {
      if (ui.isOpen()) ui.closeSuggestions();
      else if (input.value) input.value = '';
      else input.blur();
      e.preventDefault();
    }
  });
  ui.els.list.addEventListener('mousedown', (e) => {
    const li = e.target.closest('li[data-i]');
    if (!li) return;
    e.preventDefault(); // keep focus in the input
    const it = ui.list.items[Number(li.dataset.i)];
    if (it) submit(it.id);
  });
  ui.els.list.addEventListener('mousemove', (e) => {
    const li = e.target.closest('li[data-i]');
    if (!li) return;
    const i = Number(li.dataset.i);
    if (i !== ui.list.active) {
      ui.list.active = i;
      ui.list.moved = true;
      ui.moveActive(0);
    }
  });

  // Typing anywhere goes to the input; Esc closes an open popover.
  document.addEventListener('keydown', (e) => {
    if (e.key === 'Escape' && ui.popIsOpen()) {
      ui.closePop();
      e.preventDefault();
      return;
    }
    const ae = document.activeElement;
    if (ARROWS[e.key] && (!ae || ae === document.body || ae === canvas) && !ui.popIsOpen()) {
      arrowTurn(e);
      return;
    }
    if (isOver(S.game) || e.metaKey || e.ctrlKey || e.altKey) return;
    if (document.activeElement === input) return;
    const tag = document.activeElement?.tagName;
    if (e.key.length === 1 && e.key !== ' ' && tag !== 'INPUT' && tag !== 'TEXTAREA') {
      ui.closePop({ restoreFocus: false });
      input.focus();
    }
  });

  // --- header tools
  const hBtn = document.getElementById('btn-h');
  function setH(on, animate = true) {
    hBtn.setAttribute('aria-pressed', String(on));
    const label = on ? 'Hide hydrogens' : 'Show hydrogens';
    hBtn.title = label;
    hBtn.setAttribute('aria-label', label);
    renderer.setShowH(on, animate);
  }
  hBtn.addEventListener('click', () => setH(hBtn.getAttribute('aria-pressed') !== 'true'));

  document.getElementById('btn-theme').addEventListener('click', () => {
    const next = effectiveTheme() === 'dark' ? 'light' : 'dark';
    if (next === systemTheme()) {
      delete root.dataset.theme; // back to following the system
      store.remove(keys.theme);
    } else {
      root.dataset.theme = next;
      store.set(keys.theme, next);
    }
    renderer.setTheme(next);
  });
  sysDark.addEventListener('change', () => renderer.setTheme(effectiveTheme()));

  /** Expert switch. Before the first guess it converts the current game; after, it waits. Returns `pending`. */
  function setExpert(on) {
    expert = on;
    if (on) store.set(keys.expert, true);
    else store.remove(keys.expert);
    if (!S.game.guesses.length && !isOver(S.game)) {
      S.game = newGame(S.game.answer, { hard: on });
      S.hints = buildHints(S.drug, { hard: on });
      persist();
      syncPlay(false);
      return false;
    }
    const pending = !!S.game.hard !== on;
    if (pending && !isOver(S.game)) ui.noteOnce(on ? 'Expert starts with your next molecule' : 'Expert ends with your next molecule');
    return pending; // true: the change waits for the next molecule
  }

  const statsData = () => ({
    expert,
    pending: !!S.game.hard !== expert,
    onExpert: setExpert,
    stats,
    streak: displayStreak(stats, today),
    winRate: winRate(stats),
    todayGuesses: stats.lastRecorded === today && stats.lastWinDate === today ? todayGuesses() : 0,
  });
  function todayGuesses() {
    const g = SHOT ? (S.mode === 'daily' ? S.game : null) : restore(store.get(keys.game(today)), daily.id);
    return g && g.status === 'solved' ? g.guesses.length : 0;
  }
  const archiveData = () => ({
    entries: archiveEntries(ids, today, (d) => (SHOT ? null : store.get(keys.game(d))), nameOf),
    current: S.mode === 'archive' ? S.date : null,
    onPick: (d) => open('archive', { date: d }),
    onPractice: () => open('practice'),
  });
  ui.els.statsBtn.addEventListener('click', (e) => {
    e.stopPropagation();
    ui.toggleStats(undefined, statsData());
  });
  ui.els.archiveBtn.addEventListener('click', (e) => {
    e.stopPropagation();
    ui.toggleArchive(undefined, archiveData());
  });
  ui.els.todayBtn.addEventListener('click', () => open('daily'));
  document.addEventListener('pointerdown', (e) => {
    if (ui.popIsOpen() && !ui.popContains(e.target)) ui.closePop({ restoreFocus: false });
  });

  // --- keep the molecule clear of the header and the dock
  const dock = document.getElementById('dock');
  const bar = document.querySelector('.bar');
  function afterLayout(animate = true) {
    const h = app.clientHeight;
    const top = bar.getBoundingClientRect().bottom - app.getBoundingClientRect().top + 4;
    const bottom = app.getBoundingClientRect().bottom - dock.getBoundingClientRect().top + 8;
    renderer.setInsets({ top, bottom: Math.min(bottom, h - top - 80) }, animate);
  }
  if (!SHOT) new ResizeObserver(() => afterLayout()).observe(dock);

  // --- a new day while the tab was open
  if (!SHOT) {
    const checkDay = () => { if (!document.hidden && toDateString(new Date()) !== today) location.reload(); };
    document.addEventListener('visibilitychange', checkDay);
    window.addEventListener('focus', checkDay);
  }

  // --- first paint
  const shotMode = SHOT ? params.get('mode') : null;
  const askedDate = params.get('date');
  if (shotMode === 'practice') {
    open('practice', { swap: false, demo: params.get('demo') });
  } else if (shotMode === 'archive') {
    open('archive', { date: archiveDates(today).slice(-1)[0] || today, swap: false, demo: params.get('demo') });
  } else if (!SHOT && askedDate && isArchiveDate(today, askedDate)) {
    open('archive', { date: askedDate, swap: false });
  } else {
    if (SHOT && params.get('demo') === 'solved') stats = demoStats();
    open('daily', { swap: false, demo: SHOT ? params.get('demo') : null });
  }
  if (SHOT && params.get('h') === '1') setH(true, false);
  afterLayout(false);
  app.dataset.state = 'ready';
  if (SHOT) {
    renderer.resize();
    renderer.render();
    if (params.get('stats') === '1') ui.toggleStats(true, statsData());
    if (params.get('archive') === '1') ui.toggleArchive(true, archiveData());
    if (params.get('bench') === '1') {
      const withBurst = params.get('burst') === '1';
      const ms = renderer.bench(300, { burst: withBurst });
      ui.els.note.textContent = `bench · ${S.drug.name} · ${S.drug.atoms.length} atoms${params.get('h') === '1' ? ' (H shown)' : ''}${withBurst ? ' + burst' : ''} · ${ms.toFixed(3)} ms/frame`;
      renderer.render();
    }
  }
}

/** Fixed, storage-free games for screenshots. */
function demoGame(kind, answer, ids, hard = false) {
  const wrong = [...ids].sort().filter((id) => id !== answer);
  const pick = (n) => [0, 37, 74, 111, 148].slice(0, n).map((k) => wrong[k % wrong.length]);
  let game = newGame(answer, { hard });
  const play = (list) => { for (const id of list) game = reduce(game, { type: 'GUESS', id }); };
  if (kind === 'solved') play([...pick(2), answer]);
  else if (kind === 'failed') play([...pick(5), wrong[180 % wrong.length]]);
  else if (kind === 'playing') play(pick(5)); // five misses: every clue showing, including the glow
  else if (kind === 'early') play(pick(2));
  else if (kind === 'mid') play(pick(3));
  return game;
}

function demoStats() {
  return { ...emptyStats(), played: 41, wins: 39, streak: 12, maxStreak: 19, dist: [3, 9, 14, 8, 4, 1], lastWinDate: today, lastRecorded: today };
}

// ---------------------------------------------------------------- boot
if (SHOT) {
  let data = null;
  try { data = loadSync(); } catch { data = null; }
  if (validData(data)) start(data, false);
  else showError();
} else {
  Promise.all([loadAsync(), aiAvailable()])
    .then(([data, ai]) => (validData(data) ? start(data, ai) : showError()))
    .catch(showError);
}
