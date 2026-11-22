import * as THREE from "three";

/* A hollow six-armed "jack": three round tubes through one centre, filleted where they meet,
   rounded at the rims, with a bore through every arm. Built from a signed distance field and
   meshed with surface nets, so the fillets are real geometry and the normals are smooth. */

const R = 1 / 3;    // tube outer radius: 1/3 of the reach, as on the reference
const L = 1.0;      // centre to arm end
const HOLE = 0.125; // bore radius
const RIM = 0.07;   // rounding of the outer rim
const FILLET = 0.06;
const LIP = 0.035;  // rounding of the bore lip

function smin(a, b, k) { const h = Math.max(k - Math.abs(a - b), 0) / k; return Math.min(a, b) - h * h * k * 0.25; }
function smax(a, b, k) { return -smin(-a, -b, k); }

function roundCyl(perp, along) {
  const dx = perp - (R - RIM), dy = Math.abs(along) - (L - RIM);
  const ox = Math.max(dx, 0), oy = Math.max(dy, 0);
  return Math.min(Math.max(dx, dy), 0) + Math.hypot(ox, oy) - RIM;
}

export function jackSDF(x, y, z) {
  const px = Math.hypot(y, z), py = Math.hypot(x, z), pz = Math.hypot(x, y);
  let d = smin(smin(roundCyl(px, x), roundCyl(py, y), FILLET), roundCyl(pz, z), FILLET);
  d = smax(d, HOLE - px, LIP);
  d = smax(d, HOLE - py, LIP);
  d = smax(d, HOLE - pz, LIP);
  return d;
}

export function buildJackGeometry(N = 96) {
  const B = L + 0.06, h = (2 * B) / N, S = N + 1;
  const val = new Float32Array(S * S * S);
  const gi = (i, j, k) => i + S * (j + S * k);
  for (let k = 0; k < S; k++) for (let j = 0; j < S; j++) for (let i = 0; i < S; i++)
    val[gi(i, j, k)] = jackSDF(-B + i * h, -B + j * h, -B + k * h);

  const cellVert = new Int32Array(N * N * N).fill(-1);
  const ci = (i, j, k) => i + N * (j + N * k);
  const pos = [], nrm = [], ao = [];
  const E = [[0, 1], [2, 3], [4, 5], [6, 7], [0, 2], [1, 3], [4, 6], [5, 7], [0, 4], [1, 5], [2, 6], [3, 7]];
  const C = [[0, 0, 0], [1, 0, 0], [0, 1, 0], [1, 1, 0], [0, 0, 1], [1, 0, 1], [0, 1, 1], [1, 1, 1]];
  const v8 = new Float32Array(8);
  const eps = 1e-3;
  const grad = (x, y, z) => {
    const gx = jackSDF(x + eps, y, z) - jackSDF(x - eps, y, z);
    const gy = jackSDF(x, y + eps, z) - jackSDF(x, y - eps, z);
    const gz = jackSDF(x, y, z + eps) - jackSDF(x, y, z - eps);
    const l = Math.hypot(gx, gy, gz) || 1;
    return [gx / l, gy / l, gz / l];
  };
  for (let k = 0; k < N; k++) for (let j = 0; j < N; j++) for (let i = 0; i < N; i++) {
    let neg = 0;
    for (let c = 0; c < 8; c++) { v8[c] = val[gi(i + C[c][0], j + C[c][1], k + C[c][2])]; if (v8[c] < 0) neg++; }
    if (neg === 0 || neg === 8) continue;
    let ax = 0, ay = 0, az = 0, n = 0;
    for (const [a, b] of E) {
      const va = v8[a], vb = v8[b];
      if ((va < 0) === (vb < 0)) continue;
      const t = va / (va - vb);
      ax += C[a][0] + (C[b][0] - C[a][0]) * t; ay += C[a][1] + (C[b][1] - C[a][1]) * t; az += C[a][2] + (C[b][2] - C[a][2]) * t; n++;
    }
    let x = -B + (i + ax / n) * h, y = -B + (j + ay / n) * h, z = -B + (k + az / n) * h;
    for (let it = 0; it < 3; it++) { // pull the vertex onto the surface
      const d = jackSDF(x, y, z), g = grad(x, y, z);
      x -= g[0] * d; y -= g[1] * d; z -= g[2] * d;
    }
    cellVert[ci(i, j, k)] = pos.length / 3;
    const nv = grad(x, y, z);
    pos.push(x, y, z); nrm.push(...nv);
    // baked ambient occlusion: how quickly the field closes in along the normal (inner corners of the cross go dark)
    let occ = 0;
    for (let s = 1; s <= 5; s++) { const h = s * 0.07; occ += (h - Math.max(0, jackSDF(x + nv[0] * h, y + nv[1] * h, z + nv[2] * h))) / Math.pow(1.6, s); }
    ao.push(Math.max(0, Math.min(1, 1 - occ * 2.2)));
  }

  const index = [];
  const quad = (a, b, c, d, flip) => {
    if (a < 0 || b < 0 || c < 0 || d < 0) return;
    if (flip) index.push(a, c, b, a, d, c); else index.push(a, b, c, a, c, d);
  };
  for (let k = 0; k < N; k++) for (let j = 0; j < N; j++) for (let i = 0; i < N; i++) {
    const v0 = val[gi(i, j, k)] < 0;
    if (j > 0 && k > 0 && i < N && (val[gi(i + 1, j, k)] < 0) !== v0)
      quad(cellVert[ci(i, j - 1, k - 1)], cellVert[ci(i, j, k - 1)], cellVert[ci(i, j, k)], cellVert[ci(i, j - 1, k)], !v0);
    if (i > 0 && k > 0 && j < N && (val[gi(i, j + 1, k)] < 0) !== v0)
      quad(cellVert[ci(i - 1, j, k - 1)], cellVert[ci(i - 1, j, k)], cellVert[ci(i, j, k)], cellVert[ci(i, j, k - 1)], !v0);
    if (i > 0 && j > 0 && k < N && (val[gi(i, j, k + 1)] < 0) !== v0)
      quad(cellVert[ci(i - 1, j - 1, k)], cellVert[ci(i, j - 1, k)], cellVert[ci(i, j, k)], cellVert[ci(i - 1, j, k)], !v0);
  }
  // make every triangle face along its smooth normal
  for (let t = 0; t < index.length; t += 3) {
    const a = index[t] * 3, b = index[t + 1] * 3, c = index[t + 2] * 3;
    const ux = pos[b] - pos[a], uy = pos[b + 1] - pos[a + 1], uz = pos[b + 2] - pos[a + 2];
    const vx = pos[c] - pos[a], vy = pos[c + 1] - pos[a + 1], vz = pos[c + 2] - pos[a + 2];
    const fx = uy * vz - uz * vy, fy = uz * vx - ux * vz, fz = ux * vy - uy * vx;
    const dot = fx * (nrm[a] + nrm[b] + nrm[c]) + fy * (nrm[a + 1] + nrm[b + 1] + nrm[c + 1]) + fz * (nrm[a + 2] + nrm[b + 2] + nrm[c + 2]);
    if (dot < 0) { const s = index[t + 1]; index[t + 1] = index[t + 2]; index[t + 2] = s; }
  }
  const g = new THREE.BufferGeometry();
  g.setAttribute("position", new THREE.Float32BufferAttribute(pos, 3));
  g.setAttribute("normal", new THREE.Float32BufferAttribute(nrm, 3));
  g.setAttribute("bakedAO", new THREE.Float32BufferAttribute(ao, 1));
  g.setIndex(index);
  g.computeBoundingSphere();
  return g;
}
