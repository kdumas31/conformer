// renderer.js — Canvas 2D ball-and-stick renderer with pointer handling (DOM).
//
// Pure maths lives in geometry.js. This file owns the canvas, the sprite cache,
// the animation loop and the pointer/wheel gestures.

import {
  apply, rotate, radiusOf, visibleAtoms, centroid, boundingRadius, project,
  bondHalves, decay, dragAngles, clampZoom, initialPose, fogMix, FOG_MAX, pulseAt, PULSE_MS,
  backingSize, approach, releaseVelocity, spinExtent, spinFitScale, victoryTurn, SPIN_MS,
  principalSpread, isFlat, driftRates, nudgeVelocity, NUDGE_STEP,
} from './geometry.js';
import { makeBurst, burstAt, burstAlive } from './burst.js';

// CPK-ish, muted per theme.
const PALETTE = {
  dark: {
    C: '#878d96', N: '#6f9be8', O: '#e8684f', S: '#dcb44a', F: '#86d0a0',
    Cl: '#4fbfa6', Br: '#c27355', I: '#a184d4', P: '#ec9450', H: '#e9e4d8',
  },
  // Light: a warm, pale graphite so the page stays airy; heteroatoms stay saturated.
  light: {
    C: '#9a948a', N: '#2c62d8', O: '#de4a2c', S: '#d2a21c', F: '#2a9e68',
    Cl: '#13937d', Br: '#a8532a', I: '#7a4fc0', P: '#e07a26', H: '#fbf8f1',
  },
};

const FOG_LEVELS = 12;               // sprite variants per element
const DIM = 0.25;                    // non-highlighted atoms during hint 5
const BOND_W = 0.19;                 // stick diameter, Å
const ATOM_DRAW = 0.86;              // drawn radius relative to ATOM_RADIUS (≈ 0.26 × vdW)
const IDLE_BEFORE_DRIFT = 2000;      // ms after interaction
const EPS_V = 2e-6;                  // rad/ms; slower than this, inertia ends

// ---------------------------------------------------------------- colour helpers
function hexToRgb(hex) {
  const h = hex.trim().replace('#', '');
  const f = h.length === 3 ? h.split('').map((c) => c + c).join('') : h;
  const n = parseInt(f, 16);
  return [(n >> 16) & 255, (n >> 8) & 255, n & 255];
}
const mix = (a, b, t) => [a[0] + (b[0] - a[0]) * t, a[1] + (b[1] - a[1]) * t, a[2] + (b[2] - a[2]) * t];
const css = (c, alpha = 1) => `rgba(${c[0] | 0},${c[1] | 0},${c[2] | 0},${alpha})`;
const WHITE = [255, 255, 255];
const BLACK = [0, 0, 0];

function cssVar(name, fallback) {
  const v = getComputedStyle(document.documentElement).getPropertyValue(name).trim();
  return /^#[0-9a-f]{3,6}$/i.test(v) ? v : fallback;
}

// ---------------------------------------------------------------- renderer
export function createRenderer(canvas, opts = {}) {
  const ctx = canvas.getContext('2d', { alpha: true });
  const still = !!opts.still; // shot mode: one frame, no loop

  const st = {
    drug: null,
    atoms: [],
    bonds: [],
    M: null,
    step: 0,
    // fit (animated)
    c: [0, 0, 0], cT: [0, 0, 0],
    R: 1, RT: 1,
    zoom: 1, zoomT: 1,
    ins: { top: 0, bottom: 0 }, insT: { top: 0, bottom: 0 },
    hMix: 0, hT: 0,
    // motion
    vx: 0, vy: 0,
    drift: 0,
    driftClock: 0, // ms; advances by dt × drift, so a paused sway resumes without a jump
    flat: false,   // flat molecules sway instead of turning (see geometry.driftRates)
    lastInput: -Infinity,
    // effects
    highlight: null, // Set of atom indices (kept while the halo fades out)
    hlOn: false,
    hlMix: 0,
    spinStart: -Infinity, spinAngle: 0,
    scale: 0, // px per Å, eased toward the spin fit
    alpha: 1, alphaT: 1, pending: null, // cross-fade between molecules
    pulseStart: -Infinity,
    solvedGlow: false,
    burstStart: Infinity, // when the atom confetti should launch (fresh solves only)
    burst: null,          // { t0, parts } while particles live
    // canvas
    cssW: 1, cssH: 1, ratio: 1,
    theme: 'dark',
    reduced: matchMedia('(prefers-reduced-motion: reduce)').matches,
  };

  // pointer state (used by the loop too)
  const pointers = new Map();
  let dragging = false;
  let samples = [];
  let pinch = null;

  // ---------------------------------------------------------------- sprites
  let colors = {};     // el → rgb
  let bg = [14, 16, 20];
  let accent = [232, 178, 90];
  let good = [111, 207, 151];
  let spriteSize = 0;
  let sprites = new Map();   // `${el}|${level}` → canvas
  let glows = new Map();     // rgb key → canvas
  let bondCols = new Map();  // `${el}|${level}` → { base, hi }

  function readTheme() {
    const dark = st.theme !== 'light';
    colors = {};
    for (const [el, hex] of Object.entries(PALETTE[dark ? 'dark' : 'light'])) colors[el] = hexToRgb(hex);
    bg = hexToRgb(cssVar('--bg', dark ? '#0e1014' : '#f6f2ea'));
    accent = hexToRgb(cssVar('--accent', dark ? '#e8b25a' : '#b06a12'));
    good = hexToRgb(cssVar('--good', dark ? '#6fcf97' : '#2e8b57'));
    sprites.clear();
    glows.clear();
    bondCols.clear();
  }

  const colorOf = (el) => colors[el] || colors.C;

  function sprite(el, level) {
    const key = `${el}|${level}`;
    let s = sprites.get(key);
    if (s) return s;
    const S = spriteSize;
    s = document.createElement('canvas');
    s.width = s.height = S;
    const g = s.getContext('2d');
    const fog = (level / (FOG_LEVELS - 1)) * (FOG_MAX + DIM);
    const light = st.theme === 'light';
    const base = mix(colorOf(el), bg, fog);
    const r = S / 2 - 1;
    const grad = g.createRadialGradient(S * 0.37, S * 0.33, S * 0.02, S / 2, S / 2, r);
    grad.addColorStop(0, css(mix(base, WHITE, light ? 0.7 : 0.5)));
    grad.addColorStop(0.24, css(mix(base, WHITE, light ? 0.3 : 0.18)));
    grad.addColorStop(0.6, css(base));
    grad.addColorStop(0.9, css(mix(base, BLACK, light ? 0.16 : 0.42)));
    grad.addColorStop(1, css(mix(base, BLACK, light ? 0.24 : 0.6)));
    g.fillStyle = grad;
    g.beginPath();
    g.arc(S / 2, S / 2, r, 0, Math.PI * 2);
    g.fill();
    // soft specular, fading with fog
    const spec = g.createRadialGradient(S * 0.36, S * 0.31, 0, S * 0.36, S * 0.31, S * 0.2);
    spec.addColorStop(0, `rgba(255,255,255,${((light ? 0.55 : 0.42) * (1 - fog)).toFixed(3)})`);
    spec.addColorStop(1, 'rgba(255,255,255,0)');
    g.fillStyle = spec;
    g.fill();
    // a hairline of background at the rim separates overlapping spheres
    g.lineWidth = Math.max(1, S / 90);
    g.strokeStyle = css(bg, light ? 0.35 : 0.5);
    g.stroke();
    sprites.set(key, s);
    return s;
  }

  function glowSprite(rgb) {
    const key = rgb.join(',');
    let s = glows.get(key);
    if (s) return s;
    const S = 128;
    s = document.createElement('canvas');
    s.width = s.height = S;
    const g = s.getContext('2d');
    const grad = g.createRadialGradient(S / 2, S / 2, 0, S / 2, S / 2, S / 2);
    grad.addColorStop(0, css(rgb, 0.9));
    grad.addColorStop(0.35, css(rgb, 0.5));
    grad.addColorStop(1, css(rgb, 0));
    g.fillStyle = grad;
    g.fillRect(0, 0, S, S);
    glows.set(key, s);
    return s;
  }

  function bondColor(el, level) {
    const key = `${el}|${level}`;
    let c = bondCols.get(key);
    if (c) return c;
    const fog = (level / (FOG_LEVELS - 1)) * (FOG_MAX + DIM);
    const base = mix(mix(colorOf(el), BLACK, st.theme === 'light' ? 0.06 : 0.22), bg, fog);
    const hi = mix(mix(colorOf(el), WHITE, 0.35), bg, fog);
    c = { base: css(base), hi: css(hi, st.theme === 'light' ? 0.38 : 0.5) };
    bondCols.set(key, c);
    return c;
  }

  const levelOf = (fog) => Math.max(0, Math.min(FOG_LEVELS - 1, Math.round((fog / (FOG_MAX + DIM)) * (FOG_LEVELS - 1))));

  // Sprites are rasterised near the largest on-screen size, so edges stay crisp.
  function ensureSpriteSize(scale) {
    const need = 2 * 0.62 * scale * st.ratio * 1.45 * 1.34; // biggest atom × perspective × pulse
    const S = Math.min(512, Math.max(48, Math.ceil(need / 32) * 32));
    if (S > spriteSize || S < spriteSize / 2) {
      spriteSize = S;
      sprites.clear();
    }
  }

  // ---------------------------------------------------------------- model
  function targets() {
    const vis = visibleAtoms(st.atoms, st.hT > 0.5);
    const c = centroid(st.atoms, vis);
    return { c, R: boundingRadius(st.atoms, vis, c) };
  }

  function setMolecule(drug) {
    st.drug = drug;
    st.atoms = drug.atoms;
    st.bonds = drug.bonds;
    const heavy = visibleAtoms(st.atoms, false);
    const c = centroid(st.atoms, heavy);
    st.M = initialPose(st.atoms, heavy, c);
    st.flat = isFlat(principalSpread(st.atoms, heavy, c).sd);
    st.driftClock = 0;
    const t = targets();
    st.c = t.c.slice(); st.cT = t.c;
    st.R = st.RT = t.R;
    st.vx = st.vy = 0;
    st.drift = 0;
    st.lastInput = performance.now() - IDLE_BEFORE_DRIFT + 600; // drift eases in soon after load
    st.highlight = null;
    st.hlOn = false;
    st.hlMix = 0;
    st.pulseStart = -Infinity;
    st.spinStart = -Infinity;
    st.solvedGlow = false;
    clearBurst();
    st.scale = 0; // snap the fit on the first frame
    st.zoom = st.zoomT = 1;
    wake();
  }

  /** Fade the current molecule out, swap, fade the new one in. */
  function swapMolecule(drug) {
    if (!st.drug || still || st.reduced) { setMolecule(drug); st.alpha = st.alphaT = 1; draw(); return; }
    st.pending = drug;
    st.alphaT = 0;
    wake();
  }

  function refit(animate = true) {
    const t = targets();
    st.cT = t.c;
    st.RT = t.R;
    if (!animate || st.reduced) { st.c = t.c.slice(); st.R = t.R; }
  }

  // ---------------------------------------------------------------- draw
  let dtNow = 16;        // ms since the previous frame, for the eased fit
  let fitMoving = false; // the fit has not settled yet
  function draw(now = performance.now()) {
    fitMoving = false;
    const { cssW: w, cssH: h, ratio } = st;
    ctx.setTransform(ratio, 0, 0, ratio, 0, 0);
    ctx.clearRect(0, 0, w, h);
    if (!st.drug) return;

    const regionH = Math.max(80, h - st.ins.top - st.ins.bottom);
    const cx = w / 2;
    const cy = st.ins.top + regionH / 2;
    const R = st.R;
    const showH = st.hMix > 0.001;
    const hl = st.highlight;
    const hlMix = st.hlMix;
    const pulseT = now - st.pulseStart;
    const pulsing = !st.reduced && pulseT >= 0 && pulseT < PULSE_MS;
    const halo = hl && hlMix > 0.01 ? (st.reduced ? 1 : 0.72 + 0.28 * Math.sin(now / 420)) * hlMix : 0;

    // rotate atoms, then fit the spinning molecule to the stage
    const n = st.atoms.length;
    const P = new Array(n);  // rotated, centred Å
    const S = new Array(n);  // screen [x, y, s, z]
    const rad = new Float64Array(n); // Å, with H fade and pulse
    const glow = new Float64Array(n);
    const items = [];
    for (let i = 0; i < n; i++) {
      const a = st.atoms[i];
      const isH = a[0] === 'H';
      if (isH && !showH) continue;
      P[i] = apply(st.M, [a[1] - st.c[0], a[2] - st.c[1], a[3] - st.c[2]]);
      rad[i] = radiusOf(a[0]) * ATOM_DRAW * (isH ? st.hMix : 1);
    }
    const target = spinFitScale(w, regionH, spinExtent(P, rad, R), st.zoom);
    st.scale = st.scale > 0 && !st.reduced && !still ? approach(st.scale, target, dtNow, 380) : target;
    if (Math.abs(st.scale - target) > target * 1e-3) fitMoving = true;
    const scale = st.scale;
    ensureSpriteSize(scale);
    ctx.globalAlpha = 1;
    const fade = st.alpha;

    for (let i = 0; i < n; i++) {
      const p = P[i];
      if (!p) continue;
      S[i] = project(p, R, scale, cx, cy);
      let r = rad[i];
      if (pulsing) {
        const pl = pulseAt(pulseT, Math.hypot(p[0], p[1], p[2]) / R);
        r *= pl.scale;
        glow[i] = pl.glow;
      }
      rad[i] = r;
      items.push({ t: 0, i, z: p[2] });
    }

    // bond halves
    for (const [ia, ib, order] of st.bonds) {
      if (!P[ia] || !P[ib]) continue;
      const halves = bondHalves(P[ia], P[ib], rad[ia] * 0.92, rad[ib] * 0.92);
      if (!halves) continue;
      const hFade = st.atoms[ia][0] === 'H' || st.atoms[ib][0] === 'H' ? st.hMix : 1;
      // screen-space perpendicular for multiple bonds
      const dx = S[ib][0] - S[ia][0], dy = S[ib][1] - S[ia][1];
      const L = Math.hypot(dx, dy) || 1;
      const nx = -dy / L, ny = dx / L;
      const lit = nx + ny <= 0 ? 1 : -1; // which side of the stick faces the upper-left light
      halves.forEach((hf, k) => {
        const own = k === 0 ? ia : ib;
        items.push({ t: 1, own, a: hf[0], b: hf[1], z: (hf[0][2] + hf[1][2]) / 2, order, nx, ny, lit, hFade });
      });
    }

    items.sort((p, q) => p.z - q.z);

    // reduced-motion success: one soft, still glow behind everything
    if (st.solvedGlow) {
      const g = glowSprite(good);
      const rr = R * scale * 1.15;
      ctx.globalAlpha = 0.22 * fade;
      ctx.drawImage(g, cx - rr, cy - rr, rr * 2, rr * 2);
    }
    ctx.globalAlpha = fade;

    ctx.lineCap = 'round';
    for (const it of items) {
      if (it.t === 0) {
        const i = it.i;
        const [x, y, s] = S[i];
        const r = rad[i] * scale * s;
        if (r < 0.2) continue;
        const el = st.atoms[i][0];
        const isHl = hl && hl.has(i);
        let fog = fogMix(it.z, R);
        if (hl && !isHl) fog += DIM * hlMix;
        if (isHl && halo > 0) {
          const gs = glowSprite(accent);
          const gr = r * 2.8;
          ctx.globalAlpha = halo * fade;
          ctx.drawImage(gs, x - gr, y - gr, gr * 2, gr * 2);
          ctx.globalAlpha = fade;
        }
        if (glow[i] > 0.02) {
          const gs = glowSprite(good);
          const gr = r * 2.3;
          ctx.globalAlpha = Math.min(1, glow[i]) * 0.7 * fade;
          ctx.drawImage(gs, x - gr, y - gr, gr * 2, gr * 2);
          ctx.globalAlpha = fade;
        }
        const spr = sprite(el, levelOf(fog));
        ctx.drawImage(spr, x - r, y - r, r * 2, r * 2);
      } else {
        const el = st.atoms[it.own][0];
        let fog = fogMix(it.z, R);
        if (hl && !hl.has(it.own)) fog += DIM * hlMix;
        const col = bondColor(el, levelOf(fog));
        const A = project(it.a, R, scale, cx, cy);
        const B = project(it.b, R, scale, cx, cy);
        const s = (A[2] + B[2]) / 2;
        const full = BOND_W * scale * s * it.hFade;
        if (full < 0.2) continue;
        const order = Math.min(3, Math.max(1, it.order));
        const w = order === 1 ? full : order === 2 ? full * 0.62 : full * 0.48;
        const gap = order === 1 ? 0 : order === 2 ? full * 0.62 : full * 0.72;
        for (let k = 0; k < order; k++) {
          const off = (k - (order - 1) / 2) * gap;
          const ox = it.nx * off, oy = it.ny * off;
          ctx.strokeStyle = col.base;
          ctx.lineWidth = w;
          ctx.beginPath();
          ctx.moveTo(A[0] + ox, A[1] + oy);
          ctx.lineTo(B[0] + ox, B[1] + oy);
          ctx.stroke();
          // a narrow highlight toward the light (upper left) reads as a tube
          const hx = ox + it.nx * w * 0.16 * it.lit;
          const hy = oy + it.ny * w * 0.16 * it.lit;
          ctx.strokeStyle = col.hi;
          ctx.lineWidth = w * 0.34;
          ctx.beginPath();
          ctx.moveTo(A[0] + hx, A[1] + hy);
          ctx.lineTo(B[0] + hx, B[1] + hy);
          ctx.stroke();
        }
      }
    }

    // atom confetti: launched from where the heavy atoms are on screen right now
    if (now >= st.burstStart && !st.burst) {
      const pts = [];
      for (let i = 0; i < n; i++) if (S[i] && st.atoms[i][0] !== 'H') pts.push({ x: S[i][0], y: S[i][1], el: st.atoms[i][0] });
      st.burst = { t0: now, parts: makeBurst(pts) };
      st.burstStart = Infinity;
      canvas.dataset.fx = 'burst';
    }
    if (st.burst) {
      const t = now - st.burst.t0;
      if (!burstAlive(st.burst.parts, t)) {
        clearBurst();
      } else {
        for (const p of st.burst.parts) {
          const q = burstAt(p, t);
          if (q.alpha <= 0.01) continue;
          ctx.globalAlpha = q.alpha * fade;
          ctx.fillStyle = css(colorOf(p.el));
          ctx.beginPath();
          ctx.arc(q.x, q.y, q.r, 0, Math.PI * 2);
          ctx.fill();
        }
      }
    }
    ctx.globalAlpha = 1;
  }

  function clearBurst() {
    st.burst = null;
    st.burstStart = Infinity;
    delete canvas.dataset.fx;
  }

  // ---------------------------------------------------------------- loop
  let raf = 0;
  let last = 0;

  function wake() {
    if (still) return;
    if (!raf && !document.hidden) {
      last = performance.now();
      raf = requestAnimationFrame(frame);
    }
  }

  function frame(now) {
    raf = 0;
    const dt = Math.min(64, Math.max(0, now - last));
    last = now;
    dtNow = dt;
    let active = false;

    // one slow victory turn about the vertical axis
    if (now - st.spinStart < SPIN_MS + 64) {
      const a = 2 * Math.PI * victoryTurn(now - st.spinStart);
      st.M = rotate(st.M, 0, a - st.spinAngle, st.step++, 8);
      st.spinAngle = a;
      st.lastInput = now; // drift waits, then eases back in
      st.drift = 0;
      active = true;
    }

    if (!dragging) {
      // inertia
      if (Math.abs(st.vx) > EPS_V || Math.abs(st.vy) > EPS_V) {
        st.M = rotate(st.M, st.vx * dt, st.vy * dt, st.step++, 8);
        st.vx = decay(st.vx, dt);
        st.vy = decay(st.vy, dt);
        active = true;
      } else {
        st.vx = st.vy = 0;
      }
      // idle drift eases back in after a pause
      if (!st.reduced) {
        const idle = now - st.lastInput > IDLE_BEFORE_DRIFT && !st.vx && !st.vy;
        st.drift = approach(st.drift, idle ? 1 : 0, dt, 700);
        if (st.drift > 1e-3) {
          const dtau = dt * st.drift;
          const { wx, wy } = driftRates(st.driftClock, st.flat);
          st.M = rotate(st.M, wx * dtau, wy * dtau, st.step++, 8);
          st.driftClock += dtau;
        }
        active = true; // drift is always pending while motion is allowed
      }
    }

    // eased values
    const ease = (cur, tgt, tau, eps) => {
      const v = approach(cur, tgt, dt, tau);
      if (Math.abs(v - tgt) > eps) { active = true; return v; }
      return tgt;
    };
    st.R = ease(st.R, st.RT, 140, 1e-4);
    for (let k = 0; k < 3; k++) st.c[k] = ease(st.c[k], st.cT[k], 140, 1e-4);
    st.zoom = ease(st.zoom, st.zoomT, 90, 1e-4);
    st.ins.top = ease(st.ins.top, st.insT.top, 160, 0.05);
    st.ins.bottom = ease(st.ins.bottom, st.insT.bottom, 160, 0.05);
    st.hMix = ease(st.hMix, st.hT, 110, 1e-3);
    st.hlMix = ease(st.hlMix, st.hlOn ? 1 : 0, 260, 1e-3);
    if (st.hlMix === 0 && !st.hlOn) st.highlight = null;
    if (st.hlOn && !st.reduced) active = true; // halo breathes
    st.alpha = ease(st.alpha, st.alphaT, 70, 0.01);
    if (st.pending && st.alpha === 0) {
      setMolecule(st.pending);
      st.pending = null;
      st.alphaT = 1;
      active = true;
    }
    if (!st.reduced && now - st.pulseStart < PULSE_MS + 32) active = true;
    if (st.burst || st.burstStart !== Infinity) active = true;

    draw(now);
    if (active || dragging || fitMoving) wake();
  }

  function snapAnimations() {
    st.R = st.RT; st.c = st.cT.slice(); st.zoom = st.zoomT;
    st.ins = { ...st.insT }; st.hMix = st.hT; st.hlMix = st.hlOn ? 1 : 0;
    st.scale = 0; st.alpha = st.alphaT = 1;
    if (st.pending) { setMolecule(st.pending); st.pending = null; }
  }

  // ---------------------------------------------------------------- size
  function resize() {
    const rect = canvas.getBoundingClientRect();
    st.cssW = Math.max(1, rect.width);
    st.cssH = Math.max(1, rect.height);
    const b = backingSize(st.cssW, st.cssH, window.devicePixelRatio);
    st.ratio = b.ratio;
    if (canvas.width !== b.w || canvas.height !== b.h) {
      canvas.width = b.w;
      canvas.height = b.h;
    }
    if (still || !raf) draw();
    wake();
  }

  if (!still) {
    new ResizeObserver(resize).observe(canvas);
    let mq;
    const watchDpr = () => {
      mq?.removeEventListener('change', onDpr);
      mq = matchMedia(`(resolution: ${window.devicePixelRatio}dppx)`);
      mq.addEventListener('change', onDpr);
    };
    function onDpr() { resize(); watchDpr(); }
    watchDpr();
    matchMedia('(prefers-reduced-motion: reduce)').addEventListener('change', (e) => {
      st.reduced = e.matches;
      if (st.reduced) { st.drift = 0; clearBurst(); snapAnimations(); }
      wake();
    });
    document.addEventListener('visibilitychange', () => { if (!document.hidden) wake(); });
  }

  // ---------------------------------------------------------------- pointers
  const minSide = () => Math.min(st.cssW, st.cssH);
  const touch = () => { st.lastInput = performance.now(); };

  function beginDrag(e) {
    dragging = true;
    st.vx = st.vy = 0;
    st.drift = 0; // stop drifting in place: rotation continues from the current pose, no jump
    samples = [{ t: e.timeStamp, x: e.clientX, y: e.clientY }];
    canvas.classList.add('dragging');
  }

  function onDown(e) {
    if (!st.drug || still) return;
    if (e.pointerType === 'mouse' && e.button !== 0) return;
    canvas.setPointerCapture(e.pointerId);
    pointers.set(e.pointerId, { x: e.clientX, y: e.clientY });
    touch();
    if (pointers.size === 1) {
      beginDrag(e);
    } else if (pointers.size === 2) {
      dragging = false;
      const [p, q] = [...pointers.values()];
      pinch = { d0: Math.hypot(p.x - q.x, p.y - q.y) || 1, z0: st.zoomT };
    }
    wake();
  }

  function onMove(e) {
    const prev = pointers.get(e.pointerId);
    if (!prev) return;
    const cur = { x: e.clientX, y: e.clientY };
    pointers.set(e.pointerId, cur);
    touch();
    if (pinch && pointers.size >= 2) {
      const [p, q] = [...pointers.values()];
      st.zoomT = st.zoom = clampZoom(pinch.z0 * (Math.hypot(p.x - q.x, p.y - q.y) / pinch.d0));
    } else if (dragging) {
      const { ax, ay } = dragAngles(cur.x - prev.x, cur.y - prev.y, minSide());
      st.M = rotate(st.M, ax, ay, st.step++, 8);
      samples.push({ t: e.timeStamp, x: cur.x, y: cur.y });
      if (samples.length > 12) samples.shift();
    }
    wake();
  }

  function onUp(e) {
    if (!pointers.has(e.pointerId)) return;
    pointers.delete(e.pointerId);
    touch();
    if (pinch) {
      if (pointers.size < 2) pinch = null;
      if (pointers.size === 1) {
        const [id, p] = [...pointers.entries()][0];
        beginDrag({ timeStamp: e.timeStamp, clientX: p.x, clientY: p.y, pointerId: id });
      }
    } else if (dragging && pointers.size === 0) {
      dragging = false;
      if (!st.reduced) {
        const v = releaseVelocity(samples, e.timeStamp, minSide());
        st.vx = v.vx;
        st.vy = v.vy;
      }
    }
    if (pointers.size === 0) {
      dragging = false;
      canvas.classList.remove('dragging');
    }
    wake();
  }

  function onWheel(e) {
    if (!st.drug || still) return;
    e.preventDefault();
    const k = e.deltaMode === 1 ? 16 : 1;
    st.zoomT = clampZoom(st.zoomT * Math.exp(-e.deltaY * k * 0.0015));
    if (st.reduced) st.zoom = st.zoomT;
    touch();
    wake();
  }

  function onDblClick() {
    st.zoomT = 1;
    if (st.reduced) st.zoom = 1;
    wake();
  }

  if (!still) {
    canvas.addEventListener('pointerdown', onDown);
    canvas.addEventListener('pointermove', onMove);
    canvas.addEventListener('pointerup', onUp);
    canvas.addEventListener('pointercancel', onUp);
    canvas.addEventListener('lostpointercapture', onUp);
    canvas.addEventListener('wheel', onWheel, { passive: false });
    canvas.addEventListener('dblclick', onDblClick);
  }

  // ---------------------------------------------------------------- API
  return {
    setMolecule,
    swapMolecule,
    setTheme(theme) {
      st.theme = theme === 'light' ? 'light' : 'dark';
      readTheme();
      if (still || !raf) draw();
      wake();
    },
    setInsets({ top = 0, bottom = 0 }, animate = true) {
      st.insT = { top, bottom };
      if (!animate || st.reduced || !st.drug) st.ins = { top, bottom };
      if (still || !raf) draw();
      wake();
    },
    setShowH(show, animate = true) {
      st.hT = show ? 1 : 0;
      if (!st.drug) return;
      refit(animate);
      if (!animate || st.reduced) st.hMix = st.hT;
      if (still || !raf) draw();
      wake();
    },
    setHighlight(indices) {
      st.hlOn = !!(indices && indices.length);
      if (st.hlOn) st.highlight = new Set(indices);
      if (st.reduced || still) {
        st.hlMix = st.hlOn ? 1 : 0;
        if (!st.hlOn) st.highlight = null;
      }
      if (still || !raf) draw();
      wake();
    },
    celebrate() {
      if (st.reduced || still) st.solvedGlow = true;
      else {
        st.pulseStart = performance.now();
        st.spinStart = st.pulseStart + 250; // the pulse lands, then one slow full turn
        st.spinAngle = 0;
        st.burstStart = st.pulseStart + 120; // the atoms' confetti, 120 ms into the pulse
      }
      if (still || !raf) draw();
      wake();
    },
    resize,
    /** Arrow keys: dx turns about the vertical axis, dy about the horizontal (±1). */
    nudge(dx, dy) {
      if (!st.drug || still) return;
      touch();
      st.drift = 0;
      if (st.reduced) {
        st.M = rotate(st.M, Math.sign(dy) * NUDGE_STEP, Math.sign(dx) * NUDGE_STEP, st.step++, 1);
        draw();
        return;
      }
      if (dx) st.vy = nudgeVelocity(st.vy, dx);
      if (dy) st.vx = nudgeVelocity(st.vx, dy);
      wake();
    },
    render() { snapAnimations(); draw(); },
    /** Mean ms per draw over n frames of the current molecule (P2-T2 check). */
    bench(n = 200, { burst = false } = {}) {
      const pose = st.M;
      draw();
      if (burst) { st.burstStart = performance.now(); draw(); } // a live burst for the whole run
      const t0 = performance.now();
      for (let k = 0; k < n; k++) {
        st.M = rotate(st.M, 0.013, 0.021, st.step++, 8);
        draw();
      }
      const ms = (performance.now() - t0) / n;
      clearBurst();
      st.M = pose;
      draw();
      return ms;
    },
    get running() { return raf !== 0; },
    heavyCount: () => visibleAtoms(st.atoms, false).length,
  };
}
