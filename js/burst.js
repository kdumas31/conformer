// burst.js — pure. Confetti made from the molecule's own atoms, for a fresh solve.
//
// makeBurst(points, rand) takes the on-screen heavy atoms at the moment of the solve,
// [{ x, y, el }] in CSS px, and returns particles that fly outward from the molecule's
// centre. burstAt(p, tMs) gives where a particle is and how visible it is.

export const BURST_MAX = 36;   // particles, at most
export const BURST_FEW = 14;   // below this many atoms, two particles per atom
const SPEED = [90, 240];       // px/s
const RADIUS = [2, 4.5];       // px
const LIFE = [900, 1400];      // ms
const DRAG = 2.2;              // 1/s, air drag
const GRAVITY = 140;           // px/s², light, pulls down (+y on screen)

const lerp = (a, b, t) => a + (b - a) * t;

/** Even sample of k items from a list of n ≥ k. */
function sampleEvenly(list, k) {
  if (list.length <= k) return list.slice();
  const out = [];
  for (let j = 0; j < k; j++) out.push(list[Math.floor((j * list.length) / k)]);
  return out;
}

export function makeBurst(points, rand = Math.random) {
  if (!points || !points.length) return [];
  let cx = 0, cy = 0;
  for (const p of points) { cx += p.x; cy += p.y; }
  cx /= points.length;
  cy /= points.length;
  const sources = points.length < BURST_FEW
    ? points.flatMap((p) => [p, p])
    : sampleEvenly(points, BURST_MAX);
  return sources.slice(0, BURST_MAX).map((p) => {
    const dx = p.x - cx, dy = p.y - cy;
    const base = Math.hypot(dx, dy) > 0.5 ? Math.atan2(dy, dx) : rand() * 2 * Math.PI;
    const ang = base + (rand() - 0.5) * 0.9; // jitter, about ±26°
    const speed = lerp(SPEED[0], SPEED[1], rand());
    return {
      x0: p.x, y0: p.y, el: p.el,
      vx: Math.cos(ang) * speed, vy: Math.sin(ang) * speed,
      r: lerp(RADIUS[0], RADIUS[1], rand()),
      life: lerp(LIFE[0], LIFE[1], rand()),
    };
  });
}

/** Position, radius and alpha of particle p at tMs after the burst began. */
export function burstAt(p, tMs) {
  const t = Math.max(0, tMs) / 1000;
  const k = (1 - Math.exp(-DRAG * t)) / DRAG; // ∫ e^{-drag·t} dt
  const u = Math.min(1, Math.max(0, tMs) / p.life);
  const alpha = u >= 1 ? 0 : Math.pow(1 - u, 1.6);
  return {
    x: p.x0 + p.vx * k,
    y: p.y0 + p.vy * k + 0.5 * GRAVITY * t * t,
    r: p.r * (1 - 0.35 * u),
    alpha,
  };
}

/** Is any particle still visible at tMs? */
export const burstAlive = (parts, tMs) => parts.some((p) => tMs < p.life);
