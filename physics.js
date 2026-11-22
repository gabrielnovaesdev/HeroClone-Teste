/* Rigid-body pile of six-armed jacks. Plain JS (no three.js) so it can be tuned offline in Node.

   Shape: three tubes through one centre, reach 1, tube radius 1/3 of the reach (as measured on the reference).
   Collision: measured pair distances on the reference pile up hard at 2.0-2.1 and never below, so each jack collides
   as a sphere of radius SPHERE (the crosses never nest). Contacts are a stiff spring-damper plus friction at the contact
   point. Bodies are pulled toward the origin; the cursor is a ray from the camera through the pointer with a soft core
   that shoves and drags spheres; each jack also follows its own slowly turning idle spin, and a faint swirl keeps the pile alive. */

export const A = 2 / 3, RC = 1 / 3, REACH = A + RC, SPHERE = 1.05;

// Tuned offline by replaying the mouse trajectory recorded on the reference and matching chaos-robust features
// (rest spread 2.55, hover shift 0.81, sweep peak spread 3.73, sweep shift 2.04, return ~1.9 s, idle drift 0.18 u/s, spin 0.21 rad/s).
export const PHYS = {
  count: 25,
  substeps: 4,          // per 1/60 s frame
  attract: 3.4,         // pull toward the origin (per unit distance), saturates beyond attractMax
  attractMax: 4.5,
  linDamp: 1.82,        // 1/s
  angDamp: 2.32,        // 1/s
  contactK: 2500,       // sphere contact spring (per unit penetration)
  contactC: 45,         // contact damping along the normal: near-inelastic, the pile moves as a mass
  friction: 3.26,       // tangential damping at contacts (Coulomb-capped)
  cursorR: 0.6,         // cursor ray: soft core, a jack's centre ends up ~1 from the pointer as on the reference
  cursorK: 150,
  cursorC: 26,          // the cursor drags what it touches: a fast sweep carries the pile ~2 units along
  churn: 0.85,          // idle swirl acceleration
  churnScale: 0.35,
  churnSpeed: 0.25,
  churnSpin: 2.5,       // how firmly a jack follows its idle spin (also brakes spin picked up from rubbing)
  idleSpin: 0.12,       // drive for the idle spin (with the rubbing: ~0.2-0.25 rad/s median)
  spinDrift: 0.11,      // how fast the idle spin axis wanders
  inertia: 0.24,
  spinCouple: 0.15,     // jack-jack friction barely feels spin: idle spin survives contact, as on the reference
  maxSpeed: 14,
  maxSpin: 9,
};

function mulberry32(a) {
  return function () {
    a |= 0; a = (a + 0x6d2b79f5) | 0;
    let t = Math.imul(a ^ (a >>> 15), 1 | a);
    t = (t + Math.imul(t ^ (t >>> 7), 61 | t)) ^ t;
    return ((t ^ (t >>> 14)) >>> 0) / 4294967296;
  };
}

// --- small vector / quaternion helpers on arrays ---
const qmul = (a, b) => [
  a[3] * b[0] + a[0] * b[3] + a[1] * b[2] - a[2] * b[1],
  a[3] * b[1] - a[0] * b[2] + a[1] * b[3] + a[2] * b[0],
  a[3] * b[2] + a[0] * b[1] - a[1] * b[0] + a[2] * b[3],
  a[3] * b[3] - a[0] * b[0] - a[1] * b[1] - a[2] * b[2],
];
function qrot(q, v) { // v + 2 q.xyz × (q.xyz × v + w v)
  const [x, y, z, w] = q;
  const cx = y * v[2] - z * v[1] + w * v[0], cy = z * v[0] - x * v[2] + w * v[1], cz = x * v[1] - y * v[0] + w * v[2];
  return [v[0] + 2 * (y * cz - z * cy), v[1] + 2 * (z * cx - x * cz), v[2] + 2 * (x * cy - y * cx)];
}
function qnorm(q) { const l = Math.hypot(q[0], q[1], q[2], q[3]) || 1; q[0] /= l; q[1] /= l; q[2] /= l; q[3] /= l; }

// smooth divergence-free-ish swirl from a few sines
function churnField(x, y, z, t, s) {
  return [
    Math.sin(y * s + t * 1.1) + Math.cos(z * s * 1.3 - t * 0.7),
    Math.sin(z * s * 0.9 - t * 0.9) + Math.cos(x * s * 1.2 + t * 0.6),
    Math.sin(x * s * 1.1 + t * 0.8) + Math.cos(y * s * 0.8 - t * 1.2),
  ];
}

export function createPile(seed = 7) {
  const rand = mulberry32(seed);
  const P = PHYS;
  const bodies = [];
  // start as a loose ball so the pile assembles itself during the loader
  for (let i = 0; i < P.count; i++) {
    let p;
    do { p = [(rand() * 2 - 1) * 5, (rand() * 2 - 1) * 4, (rand() * 2 - 1) * 4]; } while (Math.hypot(...p) > 5.5);
    const q = [rand() - 0.5, rand() - 0.5, rand() - 0.5, rand() - 0.5]; qnorm(q);
    bodies.push({ p, v: [0, 0, 0], q, w: [(rand() - 0.5) * 0.6, (rand() - 0.5) * 0.6, (rand() - 0.5) * 0.6], f: [0, 0, 0], tq: [0, 0, 0], ax: [[0, 0, 0], [0, 0, 0], [0, 0, 0]], phase: rand() * 100 });
  }
  const cursor = { active: false, o: [0, 0, 17.5], d: [0, 0, -1], v: [0, 0, 0] }; // ray origin, unit direction, velocity at the pile
  let time = 0;

  function addForceAt(b, f, at) {
    b.f[0] += f[0]; b.f[1] += f[1]; b.f[2] += f[2];
    const rx = at[0] - b.p[0], ry = at[1] - b.p[1], rz = at[2] - b.p[2];
    b.tq[0] += ry * f[2] - rz * f[1]; b.tq[1] += rz * f[0] - rx * f[2]; b.tq[2] += rx * f[1] - ry * f[0];
  }
  // velocity of the material point at `at`; `spin` scales the rotational part (how much contacts feel the spin)
  const velAt = (b, at, spin) => {
    const rx = at[0] - b.p[0], ry = at[1] - b.p[1], rz = at[2] - b.p[2];
    return [b.v[0] + (b.w[1] * rz - b.w[2] * ry) * spin, b.v[1] + (b.w[2] * rx - b.w[0] * rz) * spin, b.v[2] + (b.w[0] * ry - b.w[1] * rx) * spin];
  };

  // n points from bj (or the cursor) toward bi; pen > 0; at = contact point
  function contactN(bi, bj, n, pen, at, k, c, fr) {
    const spin = bj ? P.spinCouple : 1;
    const va = velAt(bi, at, spin), vb = bj ? velAt(bj, at, spin) : cursor.v;
    const rv = [va[0] - vb[0], va[1] - vb[1], va[2] - vb[2]];
    const vn = rv[0] * n[0] + rv[1] * n[1] + rv[2] * n[2];
    let fn = k * pen - c * vn; if (fn < 0) fn = 0;
    const tx = rv[0] - vn * n[0], ty = rv[1] - vn * n[1], tz = rv[2] - vn * n[2];
    // Coulomb-limited viscous friction
    let ft = fr, tl = Math.hypot(tx, ty, tz);
    if (tl * ft > 0.6 * fn) ft = tl > 1e-9 ? (0.6 * fn) / tl : 0;
    const f = [n[0] * fn - tx * ft, n[1] * fn - ty * ft, n[2] * fn - tz * ft];
    addForceAt(bi, f, at);
    if (bj) addForceAt(bj, [-f[0], -f[1], -f[2]], at);
  }

  function substep(dt) {
    time += dt;
    for (const b of bodies) {
      b.f[0] = b.f[1] = b.f[2] = 0; b.tq[0] = b.tq[1] = b.tq[2] = 0;
      for (let k = 0; k < 3; k++) { const e = [0, 0, 0]; e[k] = A; b.ax[k] = qrot(b.q, e); }
      // pull toward the origin (saturating), drag
      const r = Math.hypot(...b.p), s = r > P.attractMax ? P.attractMax / r : 1;
      for (let k = 0; k < 3; k++) b.f[k] += -P.attract * b.p[k] * s - P.linDamp * b.v[k];
      // idle churn
      const ch = churnField(b.p[0], b.p[1], b.p[2], time * P.churnSpeed + b.phase * 0.01, P.churnScale);
      for (let k = 0; k < 3; k++) b.f[k] += ch[k] * P.churn;
      // each jack drifts toward its own slowly turning spin (axis persists for seconds, as on the reference)
      const sw = churnField(b.phase, b.phase * 1.7, b.phase * 2.3, time * P.spinDrift, 1);
      for (let k = 0; k < 3; k++) b.tq[k] += (sw[k] * 0.5 * P.idleSpin - b.w[k]) * P.churnSpin;
    }
    // sphere-sphere contacts (contact point on the surface, so friction turns into rolling)
    const R2 = 2 * SPHERE;
    for (let i = 0; i < bodies.length; i++) {
      const bi = bodies[i];
      for (let j = i + 1; j < bodies.length; j++) {
        const bj = bodies[j];
        const dx = bi.p[0] - bj.p[0], dy = bi.p[1] - bj.p[1], dz = bi.p[2] - bj.p[2];
        if (dx * dx + dy * dy + dz * dz >= R2 * R2) continue;
        const d = Math.hypot(dx, dy, dz) || 1e-6;
        const n = [dx / d, dy / d, dz / d];
        contactN(bi, bj, n, R2 - d, [bj.p[0] + n[0] * SPHERE, bj.p[1] + n[1] * SPHERE, bj.p[2] + n[2] * SPHERE], P.contactK, P.contactC, P.friction);
      }
    }
    // cursor: a thin ray from the camera through the pointer
    if (cursor.active) {
      const R = SPHERE + P.cursorR;
      for (const b of bodies) {
        const rx = b.p[0] - cursor.o[0], ry = b.p[1] - cursor.o[1], rz = b.p[2] - cursor.o[2];
        const t = rx * cursor.d[0] + ry * cursor.d[1] + rz * cursor.d[2];
        const q = [cursor.o[0] + cursor.d[0] * t, cursor.o[1] + cursor.d[1] * t, cursor.o[2] + cursor.d[2] * t];
        const dx = b.p[0] - q[0], dy = b.p[1] - q[1], dz = b.p[2] - q[2];
        const d = Math.hypot(dx, dy, dz);
        if (d >= R || d < 1e-6) continue;
        const n = [dx / d, dy / d, dz / d];
        contactN(b, null, n, R - d, [b.p[0] - n[0] * SPHERE, b.p[1] - n[1] * SPHERE, b.p[2] - n[2] * SPHERE], P.cursorK, P.cursorC, P.friction);
      }
    }
    // integrate (semi-implicit Euler), unit mass, scalar inertia
    const ad = Math.exp(-P.angDamp * dt);
    for (const b of bodies) {
      for (let k = 0; k < 3; k++) { b.v[k] += b.f[k] * dt; b.w[k] = (b.w[k] + (b.tq[k] / P.inertia) * dt) * ad; }
      const sp = Math.hypot(...b.v); if (sp > P.maxSpeed) for (let k = 0; k < 3; k++) b.v[k] *= P.maxSpeed / sp;
      const ws = Math.hypot(...b.w); if (ws > P.maxSpin) for (let k = 0; k < 3; k++) b.w[k] *= P.maxSpin / ws;
      for (let k = 0; k < 3; k++) b.p[k] += b.v[k] * dt;
      const dq = qmul([b.w[0] * dt * 0.5, b.w[1] * dt * 0.5, b.w[2] * dt * 0.5, 0], b.q);
      for (let k = 0; k < 4; k++) b.q[k] += dq[k];
      qnorm(b.q);
    }
  }

  function step(dt) {
    if (dt <= 0) return;
    const n = Math.max(1, Math.round((dt * 60) * P.substeps));
    const h = dt / n;
    for (let i = 0; i < n; i++) substep(h);
  }

  return { bodies, cursor, step, get time() { return time; } };
}
