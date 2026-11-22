import { createWorld } from "./world.js";

/* =========================================================================
   Timeline (ms from navigation) — numbers measured on the reference capture
   ========================================================================= */
const T = {
  trackIn: 100,          // loader track appears
  loadEnd: 2000,         // bar full, counter 100
  splitStart: 2100,      // bar splits 60/40, left piece turns +90°
  splitDur: 420,
  expandStart: 2900,     // L windows grow and open onto the hero
  expandEnd: 3500,
  chipsIn: 3770,        // header chips rise (+100 ms stagger, 813 ms, cubic-bezier(.2,0,0,1))
  titleIn: 3880,        // title words: +50 ms per word, continuing across lines
  crossIn: 4060,         // scroll-row crosses spin in
  scrollIn: 4100,        // scroll-row words, +100 ms each
};

// ?t=3300 freezes the intro clock at that millisecond (for checking single poses)
const FREEZE = new URLSearchParams(location.search).get("t");
const now = () => (FREEZE !== null ? Number(FREEZE) : performance.now());
const clamp = (v, a = 0, b = 1) => Math.min(b, Math.max(a, v));
const lerp = (a, b, k) => a + (b - a) * k;
const easeInOutCubic = (x) => (x < 0.5 ? 4 * x * x * x : 1 - Math.pow(-2 * x + 2, 3) / 2);
// piecewise-linear table lookup: [[t, v], ...]
function table(rows, t, log = false) {
  if (t <= rows[0][0]) return rows[0][1];
  for (let i = 1; i < rows.length; i++) {
    const [t1, v1] = rows[i];
    if (t <= t1) {
      const [t0, v0] = rows[i - 1];
      const k = (t - t0) / (t1 - t0);
      return log ? Math.exp(lerp(Math.log(v0), Math.log(v1), k)) : lerp(v0, v1, k);
    }
  }
  return rows[rows.length - 1][1];
}

// loader progress, measured from the reference bar width (210 px track)
const PROGRESS = [[100, 0], [200, 0.03], [400, 0.13], [600, 0.295], [800, 0.476], [1000, 0.657], [1200, 0.843],
  [1400, 0.881], [1600, 0.924], [1800, 0.967], [2000, 1]];
// expansion of the L windows (about an origin near the L's corner)
const EXP_SCALE = [[2850, 1], [3000, 1.14], [3100, 1.65], [3200, 3.95], [3300, 9], [3400, 30], [3500, 80]];
const EXP_ROT = [[2850, 0], [3000, 0.5], [3100, 1.5], [3200, 4], [3300, 9], [3400, 14], [3500, 18]];
const EXP_SKEW = [[3220, 0], [3300, -18], [3400, -24], [3500, -28]];
const EXP_TX = [[3220, 0], [3300, -120], [3400, -150], [3500, -200]];
// white veil over the hero, seen through the windows
const WASH = [[3100, 1], [3200, 0.93], [3300, 0.67], [3400, 0.2], [3500, 0.04], [3600, 0]];

/* =========================================================================
   Intro overlay (2D canvas): black, loader, rolling counter, L windows
   ========================================================================= */
const intro = document.getElementById("intro");
const wash = document.getElementById("wash");
const ctx = intro.getContext("2d");
let VW = innerWidth, VH = innerHeight, DPR = Math.min(devicePixelRatio || 1, 2);
function sizeIntro() {
  VW = innerWidth; VH = innerHeight; DPR = Math.min(devicePixelRatio || 1, 2);
  intro.width = Math.round(VW * DPR); intro.height = Math.round(VH * DPR);
}
sizeIntro();

const BAR = { w: 210, h: 42 };
const COUNTER = { size: 118, x: 5, digitW: 68.5, lineH: 118 };
let shownCount = 0;

function drawDigitColumn(value, x, baseline) {
  // value is continuous: integer part shows, fractional part rolls the next digit up from below
  const d0 = Math.floor(value) % 10, d1 = (d0 + 1) % 10, f = value - Math.floor(value);
  ctx.save();
  ctx.beginPath(); ctx.rect(x - 4, baseline - COUNTER.lineH + 10, COUNTER.digitW + 8, COUNTER.lineH); ctx.clip();
  ctx.fillText(String(d0), x, baseline - f * COUNTER.lineH);
  if (f > 0.001) ctx.fillText(String(d1), x, baseline + (1 - f) * COUNTER.lineH);
  ctx.restore();
}

function drawCounter(n) {
  ctx.fillStyle = "#fff";
  ctx.font = `400 ${COUNTER.size}px "Inter Tight", "Helvetica Neue", Arial, sans-serif`;
  ctx.textBaseline = "alphabetic";
  const ones = n % 10;
  const roll = clamp(ones - 9);                    // carry rolls during the last unit
  const tens = Math.floor(n / 10) % 10 + roll;
  const hundreds = Math.floor(n / 100) + clamp(n % 100 - 99);
  const base = VH;
  drawDigitColumn(hundreds, COUNTER.x, base);
  drawDigitColumn(tens, COUNTER.x + COUNTER.digitW, base);
  drawDigitColumn(ones, COUNTER.x + COUNTER.digitW * 2, base);
}

// one rectangle piece: centre, size, rotation (deg)
function piece(ctx2, cx, cy, w, h, rotDeg) {
  ctx2.save();
  ctx2.translate(cx, cy); ctx2.rotate((rotDeg * Math.PI) / 180);
  ctx2.fillRect(-w / 2, -h / 2, w, h);
  ctx2.restore();
}

function lPieces(t) {
  // bar at rest is centred: x 616..826, y 430..472. Split 60/40.
  const cx = VW / 2, cy = VH / 2;
  const bx = cx - BAR.w / 2, by = cy - BAR.h / 2 + 1;
  const lw = BAR.w * 0.6, rw = BAR.w * 0.4;
  const k = easeInOutCubic(clamp((t - T.splitStart) / T.splitDur));
  const left0 = { x: bx + lw / 2, y: by + BAR.h / 2 }, right0 = { x: bx + lw + rw / 2, y: by + BAR.h / 2 };
  // resting L (centred): vertical 42 x 126 above-left, horizontal 84 x 42 below-right
  const left1 = { x: cx - 41.5, y: cy - 18 }, right1 = { x: cx + 21.5, y: cy + 63 };
  return [
    { x: lerp(left0.x, left1.x, k), y: lerp(left0.y, left1.y, k), w: lw, h: BAR.h, r: 90 * k },
    { x: lerp(right0.x, right1.x, k), y: lerp(right0.y, right1.y, k), w: rw, h: BAR.h, r: 0 },
  ];
}

let introDone = false;
function drawIntro(t) {
  if (introDone) return;
  if (t >= T.expandEnd) {
    introDone = true;
    document.documentElement.classList.add("done");
    return;
  }
  intro.classList.remove("boot");      // the canvas paints its own black from here on
  ctx.setTransform(DPR, 0, 0, DPR, 0, 0);
  ctx.globalCompositeOperation = "source-over";
  ctx.clearRect(0, 0, VW, VH);
  ctx.fillStyle = "#000";
  ctx.fillRect(0, 0, VW, VH);

  const p = table(PROGRESS, t);
  // counter eases toward the progress value, rolling digits on the way
  const target = p * 100;
  shownCount = FREEZE !== null ? target : shownCount + (target - shownCount) * 0.16; // counter trails the bar a little
  if (Math.abs(target - shownCount) < 0.02) shownCount = target;
  drawCounter(t < T.trackIn ? 0 : shownCount);

  const cx = VW / 2, cy = VH / 2;
  if (t < T.splitStart) {
    if (t >= T.trackIn) {
      const bx = cx - BAR.w / 2, by = cy - BAR.h / 2 + 1;
      ctx.fillStyle = "#333";
      ctx.fillRect(bx, by, BAR.w, BAR.h);
      ctx.fillStyle = "#fff";
      ctx.fillRect(bx, by, BAR.w * p, BAR.h);
    }
  } else if (t < T.expandStart) {
    ctx.fillStyle = "#fff";
    for (const q of lPieces(t)) piece(ctx, q.x, q.y, q.w, q.h, q.r);
  } else {
    // windows: cut the two L pieces out of the black, transformed about the L corner
    const s = table(EXP_SCALE, t, true), rot = table(EXP_ROT, t), skew = table(EXP_SKEW, t);
    const ox = cx - 46, oy = cy + 26;
    ctx.globalCompositeOperation = "destination-out";
    ctx.fillStyle = "#000";
    ctx.save();
    ctx.translate(ox + table(EXP_TX, t), oy);
    ctx.rotate((rot * Math.PI) / 180);
    ctx.transform(1, 0, Math.tan((skew * Math.PI) / 180), 1, 0, 0);
    ctx.scale(s, s);
    ctx.translate(-ox, -oy);
    for (const q of lPieces(T.expandStart)) piece(ctx, q.x, q.y, q.w + 0.5, q.h + 0.5, q.r);
    ctx.restore();
    ctx.globalCompositeOperation = "source-over";
  }
  wash.style.opacity = String(table(WASH, t));
}

/* =========================================================================
   DOM reveals
   ========================================================================= */
// Every reveal is a Web Animation scheduled against the document timeline (t = 0 at navigation),
// so it lands on the same millisecond as the reference however long the script took to boot.
const EMPH = "cubic-bezier(0.2, 0, 0, 1)";
function at(el, keyframes, startMs, duration) {
  const delay = startMs - document.timeline.currentTime;
  el.animate(keyframes, { duration, delay, easing: EMPH, fill: "both" });
}
function domReveals() {
  if (matchMedia("(prefers-reduced-motion: reduce)").matches) return;
  // header chips: rise 56px → 0, 813 ms, +100 ms stagger
  ["#sound", "#talk", "#menu"].forEach((s, i) =>
    at(document.querySelector(s), [{ transform: "translateY(56px)" }, { transform: "translateY(0)" }], T.chipsIn + i * 100, 813));
  // title: one global 50 ms stagger across all words; translate 61.2px over 1000 ms, rotate 15° over 708 ms
  document.querySelectorAll("#title .word").forEach((w, i) => {
    const s = T.titleIn + i * 50;
    at(w, [{ translate: "0 61.2px" }, { translate: "0 0" }], s, 1000);
    at(w, [{ rotate: "15deg" }, { rotate: "0deg" }], s, 708);
  });
  // scroll row: crosses spin in, words scale + fade with 100 ms stagger
  document.querySelectorAll(".cross").forEach((c) =>
    at(c, [{ transform: "rotate(0deg) scale(0)" }, { transform: "rotate(180deg) scale(1)" }], T.crossIn, 580));
  document.querySelectorAll("#scroll-text .word").forEach((w, i) =>
    at(w, [{ transform: "scale(0.8)", opacity: 0 }, { transform: "scale(1)", opacity: 1 }], T.scrollIn + i * 100, 580));
}
domReveals();


/* =========================================================================
   WebGL world: page, card, 3D jacks, cursor fluid (see world.js)
   ========================================================================= */
let world = null;
try {
  world = createWorld({ canvas: document.getElementById("gl"), visual: document.getElementById("visual"), freeze: FREEZE });
  world.compile(); // compile shaders during the loader, not when the windows open
} catch (err) {
  console.error(err);
  document.documentElement.classList.add("nogl");
}

// physics starts under the intro so the pile is nearly formed when it is revealed
const SIM_START = 300; // the pile assembles itself under the loader
if (world && FREEZE !== null) for (let k = SIM_START; k < Number(FREEZE); k += 1000 / 60) world.physics(1 / 60);

addEventListener("resize", sizeIntro);
let last = now();
function frame() {
  const t = now();
  const dt = t > SIM_START ? Math.min((t - Math.max(last, SIM_START)) / 1000, 1 / 20) : 0;
  const rdt = Math.min(Math.max(t - last, 0) / 1000, 1 / 20);
  last = t;
  drawIntro(t);
  if (world) {
    world.physics(dt);
    // the intro covers everything until the windows open: skip the GPU work until then
    if (t >= T.expandStart - 50 || introDone) world.render(rdt, t / 1000, { fluidOn: introDone });
  }
  requestAnimationFrame(frame);
}
document.fonts.ready.then(() => requestAnimationFrame(frame));
