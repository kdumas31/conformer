// geometry.js — pure maths for the renderer. No DOM.
//
// Matrices are 3×3, row-major, as flat arrays of 9 numbers.
// Screen convention: +x right, +y up (flipped when projecting), +z toward the viewer.

export const ZOOM_MIN = 0.5;
export const ZOOM_MAX = 3;
export const FIT = 0.42;
export const PERSPECTIVE = 3.5; // d = 3.5 R
export const INERTIA_TAU = 600; // ms

// ≈ 0.3 × van der Waals radius (Å); hydrogen a little smaller still.
export const ATOM_RADIUS = { H: 0.27, C: 0.51, N: 0.47, O: 0.46, F: 0.44, P: 0.54, S: 0.54, Cl: 0.52, Br: 0.56, I: 0.6 };
export const radiusOf = (el) => ATOM_RADIUS[el] ?? 0.5;

// ---------------------------------------------------------------- matrices
export const identity = () => [1, 0, 0, 0, 1, 0, 0, 0, 1];

export function multiply(a, b) {
  const r = new Array(9);
  for (let i = 0; i < 3; i++) {
    for (let j = 0; j < 3; j++) {
      r[i * 3 + j] = a[i * 3] * b[j] + a[i * 3 + 1] * b[3 + j] + a[i * 3 + 2] * b[6 + j];
    }
  }
  return r;
}

export function rotX(t) {
  const c = Math.cos(t), s = Math.sin(t);
  return [1, 0, 0, 0, c, -s, 0, s, c];
}

export function rotY(t) {
  const c = Math.cos(t), s = Math.sin(t);
  return [c, 0, s, 0, 1, 0, -s, 0, c];
}

export function apply(m, [x, y, z]) {
  return [m[0] * x + m[1] * y + m[2] * z, m[3] * x + m[4] * y + m[5] * z, m[6] * x + m[7] * y + m[8] * z];
}

/** Gram–Schmidt on the rows; removes the drift that accumulates from many small rotations. */
export function orthonormalize(m) {
  const r0 = [m[0], m[1], m[2]];
  const r1 = [m[3], m[4], m[5]];
  const norm = (v) => {
    const l = Math.hypot(v[0], v[1], v[2]) || 1;
    return [v[0] / l, v[1] / l, v[2] / l];
  };
  const dot = (a, b) => a[0] * b[0] + a[1] * b[1] + a[2] * b[2];
  const a = norm(r0);
  const d = dot(r1, a);
  const b = norm([r1[0] - d * a[0], r1[1] - d * a[1], r1[2] - d * a[2]]);
  const c = [a[1] * b[2] - a[2] * b[1], a[2] * b[0] - a[0] * b[2], a[0] * b[1] - a[1] * b[0]];
  return [...a, ...b, ...c];
}

/**
 * Trackball step: rotate the orientation by ay about screen Y and ax about screen X
 * (radians). Screen-space rotations premultiply. Re-orthonormalised every
 * `every` steps when a step counter is passed, otherwise on every call.
 */
export function rotate(m, ax, ay, step = 0, every = 1) {
  const r = multiply(multiply(rotX(ax), rotY(ay)), m);
  return step % every === 0 ? orthonormalize(r) : r;
}

/** Drag in CSS px → radians; a full canvas-width drag is about one half-turn. */
export function dragAngles(dx, dy, size) {
  const k = Math.PI / Math.max(1, size);
  return { ax: dy * k, ay: dx * k };
}

export function decay(v, dtMs, tau = INERTIA_TAU) {
  return v * Math.exp(-dtMs / tau);
}

// ---------------------------------------------------------------- model fit
/** Indices of the atoms drawn (hydrogens hidden by default). */
export function visibleAtoms(atoms, showH = false) {
  const out = [];
  for (let i = 0; i < atoms.length; i++) if (showH || atoms[i][0] !== 'H') out.push(i);
  return out;
}

export function centroid(atoms, indices) {
  let x = 0, y = 0, z = 0;
  for (const i of indices) {
    x += atoms[i][1];
    y += atoms[i][2];
    z += atoms[i][3];
  }
  const n = indices.length || 1;
  return [x / n, y / n, z / n];
}

/** R = max distance from the centre + that atom's radius. */
export function boundingRadius(atoms, indices, c) {
  let r = 0;
  for (const i of indices) {
    const a = atoms[i];
    r = Math.max(r, Math.hypot(a[1] - c[0], a[2] - c[1], a[3] - c[2]) + radiusOf(a[0]));
  }
  return r || 1;
}

export const clampZoom = (z) => Math.min(ZOOM_MAX, Math.max(ZOOM_MIN, z));

/** Pixels per Å so the bounding sphere fills 2 × 0.42 of the short side. */
export function fitScale(w, h, R, zoom = 1) {
  return ((FIT * Math.min(w, h)) / R) * clampZoom(zoom);
}

/**
 * Weak perspective. p is centred and rotated (Å). Returns screen [x, y, s, z],
 * where s scales radii and line widths.
 */
export function project(p, R, scale, cx, cy) {
  const d = PERSPECTIVE * R;
  const s = d / (d - p[2]);
  return [cx + p[0] * s * scale, cy - p[1] * s * scale, s, p[2]];
}

/** Indices of items sorted far → near (ascending z), so painting in order is correct. */
export function backToFront(items, zOf = (it) => it.z) {
  return items.map((_, i) => i).sort((a, b) => zOf(items[a]) - zOf(items[b]) || a - b);
}

/**
 * The two halves of a bond in 3D, trimmed at each sphere's surface:
 * [[start, mid], [mid, end]]; null if the spheres overlap entirely.
 */
export function bondHalves(pa, pb, ra, rb) {
  const v = [pb[0] - pa[0], pb[1] - pa[1], pb[2] - pa[2]];
  const L = Math.hypot(v[0], v[1], v[2]);
  if (L <= ra + rb) return null;
  const u = [v[0] / L, v[1] / L, v[2] / L];
  const start = [pa[0] + u[0] * ra, pa[1] + u[1] * ra, pa[2] + u[2] * ra];
  const end = [pb[0] - u[0] * rb, pb[1] - u[1] * rb, pb[2] - u[2] * rb];
  const mid = [(start[0] + end[0]) / 2, (start[1] + end[1]) / 2, (start[2] + end[2]) / 2];
  return [[start, mid], [mid, end]];
}

// ---------------------------------------------------------------- pose & effects (Phase 2)

/**
 * Principal axes of the given atoms about centre c (Jacobi eigen-decomposition of
 * the 3×3 covariance). Returns a rotation matrix whose rows are the axes sorted by
 * variance, largest first, made right-handed. Applied to a centred point it puts the
 * molecule's long axis along screen x and its thinnest axis toward the viewer.
 */
export function principalAxes(atoms, indices, c) {
  return principalSpread(atoms, indices, c).axes;
}

/**
 * Principal axes plus the standard deviation of the atoms along each one:
 * { axes (as principalAxes), sd: [s1, s2, s3] }, largest first.
 */
export function principalSpread(atoms, indices, c) {
  const a = [0, 0, 0, 0, 0, 0, 0, 0, 0];
  for (const i of indices) {
    const d = [atoms[i][1] - c[0], atoms[i][2] - c[1], atoms[i][3] - c[2]];
    for (let r = 0; r < 3; r++) for (let k = 0; k < 3; k++) a[r * 3 + k] += d[r] * d[k];
  }
  let v = identity();
  for (let sweep = 0; sweep < 24; sweep++) {
    let off = 0;
    for (const [p, q] of [[0, 1], [0, 2], [1, 2]]) {
      const apq = a[p * 3 + q];
      off += Math.abs(apq);
      if (Math.abs(apq) < 1e-12) continue;
      const theta = (a[q * 3 + q] - a[p * 3 + p]) / (2 * apq);
      const t = Math.sign(theta || 1) / (Math.abs(theta) + Math.sqrt(theta * theta + 1));
      const cs = 1 / Math.sqrt(t * t + 1), sn = t * cs;
      // A ← Jᵀ A J, V ← V J  (J rotates in the p,q plane)
      const J = identity();
      J[p * 3 + p] = cs; J[q * 3 + q] = cs; J[p * 3 + q] = sn; J[q * 3 + p] = -sn;
      const Jt = [J[0], J[3], J[6], J[1], J[4], J[7], J[2], J[5], J[8]];
      const na = multiply(multiply(Jt, a), J);
      for (let k = 0; k < 9; k++) a[k] = na[k];
      v = multiply(v, J);
    }
    if (off < 1e-10) break;
  }
  const order = [0, 1, 2].sort((x, y) => a[y * 4] - a[x * 4]);
  const col = (j) => [v[j], v[3 + j], v[6 + j]];
  const e1 = col(order[0]), e2 = col(order[1]);
  const e3 = [e1[1] * e2[2] - e1[2] * e2[1], e1[2] * e2[0] - e1[0] * e2[2], e1[0] * e2[1] - e1[1] * e2[0]];
  const n = Math.max(1, indices.length);
  const sd = order.map((k) => Math.sqrt(Math.max(0, a[k * 4]) / n));
  return { axes: orthonormalize([...e1, ...e2, ...e3]), sd };
}

// ---------------------------------------------------------------- arrow keys (Phase 5)

/**
 * One arrow press adds NUDGE_IMPULSE rad/ms to the spin, which then glides out with
 * the usual inertia (about impulse × INERTIA_TAU ≈ 20° per press). Held keys repeat,
 * so the speed is capped at NUDGE_CAP. Reduced motion uses one NUDGE_STEP instead.
 */
export const NUDGE_IMPULSE = 0.35 / INERTIA_TAU;
export const NUDGE_CAP = 3 * NUDGE_IMPULSE;
export const NUDGE_STEP = (15 * Math.PI) / 180;
export function nudgeVelocity(v, dir, impulse = NUDGE_IMPULSE, cap = NUDGE_CAP) {
  const next = v + Math.sign(dir) * impulse;
  return Math.max(-cap, Math.min(cap, next));
}

// ---------------------------------------------------------------- idle drift (Phase 5)

/**
 * A molecule is flat when its thinnest spread is small next to its middle one.
 * Flat molecules sway instead of spinning, because a full turn about the vertical
 * axis always passes edge-on and they collapse into a line.
 */
export const FLAT_RATIO = 0.30;
export const isFlat = (sd) => sd[1] > 0 && sd[2] / sd[1] < FLAT_RATIO;

export const DRIFT_Y = 0.15 / 1000; // rad/ms
export const DRIFT_WOBBLE = 0.05 / 1000; // rad/ms amplitude about X
export const SWAY = { B: 0.45, C: 0.12, OMEGA: (2 * Math.PI) / 14000 };

/**
 * Idle angular rates { wx, wy } (rad/ms) at drift-clock time tMs.
 *   not flat: a steady turn about Y with a slow wobble about X;
 *   flat:     a figure-of-eight sway that returns to where it started
 *             (angles B·sin(Ωt) about Y and C·sin(2Ωt) about X).
 */
export function driftRates(tMs, flat) {
  if (!flat) return { wx: DRIFT_WOBBLE * Math.sin(tMs / 3100), wy: DRIFT_Y };
  const { B, C, OMEGA: w } = SWAY;
  return { wy: B * w * Math.cos(w * tMs), wx: 2 * C * w * Math.cos(2 * w * tMs) };
}

/** The opening pose: face-on along the principal axes, then a gentle 3D tilt. */
export const POSE_TILT = { ax: -0.38, ay: 0.52 };
export function initialPose(atoms, indices, c) {
  return rotate(principalAxes(atoms, indices, c), POSE_TILT.ax, POSE_TILT.ay);
}

/** Depth fog: 0 at the front of the bounding sphere, FOG_MAX at the back. */
export const FOG_MAX = 0.5;
export function fogMix(z, R) {
  const t = Math.min(1, Math.max(0, (R - z) / (2 * R)));
  return FOG_MAX * Math.pow(t, 1.25);
}

/**
 * Success pulse: a radius-scale wave moving outward. tMs since the pulse began,
 * dn = distance from the centre / R. Returns { scale, glow } with glow in 0..1.
 */
export const PULSE_MS = 900;
export function pulseAt(tMs, dn) {
  if (!(tMs >= 0 && tMs < PULSE_MS)) return { scale: 1, glow: 0 };
  const u = tMs / PULSE_MS;
  const front = u * 1.4 - 0.2;
  const g = Math.exp(-((dn - front) ** 2) / (2 * 0.14 * 0.14)) * (1 - u * 0.6);
  return { scale: 1 + 0.34 * g, glow: g };
}

/** Canvas backing store for a CSS box at a device pixel ratio (capped at 3). */
export const DPR_MAX = 3;
export function backingSize(cssW, cssH, dpr = 1) {
  const ratio = Math.min(DPR_MAX, Math.max(1, dpr || 1));
  return { w: Math.max(1, Math.round(cssW * ratio)), h: Math.max(1, Math.round(cssH * ratio)), ratio };
}

/** Frame-rate independent exponential approach of `cur` toward `target`. */
export function approach(cur, target, dtMs, tau) {
  return target + (cur - target) * Math.exp(-dtMs / Math.max(1, tau));
}

/** Rotation speed (rad/ms) from recent pointer samples [{t, x, y}] in CSS px. */
export function releaseVelocity(samples, now, size, windowMs = 90) {
  const recent = samples.filter((s) => now - s.t <= windowMs);
  if (recent.length < 2) return { vx: 0, vy: 0 };
  const a = recent[0], b = recent[recent.length - 1];
  const dt = Math.max(8, b.t - a.t);
  if (now - b.t > 60) return { vx: 0, vy: 0 }; // the pointer came to rest before release
  const { ax, ay } = dragAngles(b.x - a.x, b.y - a.y, size);
  return { vx: ax / dt, vy: ay / dt };
}

// ---------------------------------------------------------------- spin fit (Phase 3)

/**
 * Projected half-extents (Å, before scaling) of the molecule over a full turn
 * about screen Y, from the current pose. `pts` are rotated, centred points
 * (holes allowed for hidden atoms) and `radii` their drawn radii. The idle
 * drift turns about Y, so the result stays put while the molecule spins and
 * the fit can use the whole stage without the molecule ever leaving it.
 *   x: an atom at distance ρ from the Y axis reaches ρ·d/√(d²−ρ²) on screen;
 *   y: its height |y| is magnified at most by d/(d−ρ).
 */
export function spinExtent(pts, radii, R) {
  const d = PERSPECTIVE * R;
  let hx = 0, hy = 0;
  for (let i = 0; i < pts.length; i++) {
    const p = pts[i];
    if (!p) continue;
    const r = radii[i] || 0;
    const rho = Math.min(Math.hypot(p[0], p[2]) + r, 0.95 * d);
    hx = Math.max(hx, (rho * d) / Math.sqrt(d * d - rho * rho));
    hy = Math.max(hy, ((Math.abs(p[1]) + r) * d) / (d - rho));
  }
  return { hx: hx || 1, hy: hy || 1 };
}

/** How much of the stage the spinning molecule may fill, and the largest px/Å for tiny molecules. */
export const SPIN_FILL = { x: 0.9, y: 0.9 };
export const MAX_PX_PER_A = 0.11; // × the shorter side of the stage
export function spinFitScale(w, h, ext, zoom = 1) {
  const s = Math.min((w * 0.5 * SPIN_FILL.x) / ext.hx, (h * 0.5 * SPIN_FILL.y) / ext.hy, MAX_PX_PER_A * Math.min(w, h));
  return s * clampZoom(zoom);
}

/** Ease-in-out for the one slow victory turn: 0 → 1. */
export const SPIN_MS = 2600;
export function victoryTurn(tMs) {
  const u = Math.min(1, Math.max(0, tMs / SPIN_MS));
  return u < 0.5 ? 4 * u * u * u : 1 - Math.pow(-2 * u + 2, 3) / 2;
}
