import * as THREE from "three";

/* Cursor "screen paint": a quarter-resolution RGBA field.
   xy = velocity (stored around 0.5), z/w = paint weight.
   Every frame the cursor stamps a thin capsule from its previous to its current position carrying its velocity;
   the field then pushes itself along its own (blurred) velocity, is churned by gradient noise where it is
   thick, and fades. The composite pass smears the page along this velocity and tints fast edges.
   Constants are the values measured on the reference at 1440x900. */

const VERT = `varying vec2 vUv; void main(){ vUv = uv; gl_Position = vec4(position.xy, 0.0, 1.0); }`;

const UPDATE = /* glsl */ `
  precision highp float;
  varying vec2 vUv;
  uniform sampler2D uPrev, uLow;
  uniform vec2 uTexel;          // 1 / paint size
  uniform vec4 uFrom, uTo;      // paint px: x, y, radius, weight
  uniform vec2 uVel;
  uniform float uPush;
  uniform vec3 uFade;           // per-frame keep factor: velocity, weight z, weight w
  uniform float uNoiseScale, uNoiseAmt, uTime;

  // capsule distance from p to segment ab, plus position along it
  vec2 segment(vec2 p, vec2 a, vec2 b) {
    vec2 pa = p - a, ba = b - a;
    float h = clamp(dot(pa, ba) / max(dot(ba, ba), 1e-6), 0.0, 1.0);
    return vec2(length(pa - ba * h), h);
  }
  // 2D gradient noise, returns (value, d/dx, d/dy)
  vec2 rnd2(vec2 p) { p = vec2(dot(p, vec2(127.1, 311.7)), dot(p, vec2(269.5, 183.3))); return fract(sin(p) * 43758.5453) * 2.0 - 1.0; }
  vec3 gnoise(vec2 p) {
    vec2 i = floor(p), f = fract(p);
    vec2 u = f * f * f * (f * (f * 6.0 - 15.0) + 10.0);
    vec2 du = 30.0 * f * f * (f * (f - 2.0) + 1.0);
    vec2 g00 = rnd2(i), g10 = rnd2(i + vec2(1, 0)), g01 = rnd2(i + vec2(0, 1)), g11 = rnd2(i + vec2(1, 1));
    float v00 = dot(g00, f), v10 = dot(g10, f - vec2(1, 0)), v01 = dot(g01, f - vec2(0, 1)), v11 = dot(g11, f - vec2(1, 1));
    float k = v00 - v10 - v01 + v11;
    float v = v00 + u.x * (v10 - v00) + u.y * (v01 - v00) + u.x * u.y * k;
    vec2 d = g00 + u.x * (g10 - g00) + u.y * (g01 - g00) + u.x * u.y * (g00 - g10 - g01 + g11) + du * (u.yx * k + vec2(v10 - v00, v01 - v00));
    return vec3(v, d);
  }

  void main() {
    vec2 px = gl_FragCoord.xy;
    vec2 seg = segment(px, uFrom.xy, uTo.xy);
    vec2 rw = mix(uFrom.zw, uTo.zw, seg.y);
    float stamp = 1.0 - smoothstep(-0.01, rw.x, seg.x);

    vec4 low = texture2D(uLow, vUv);
    vec2 push = (0.5 - low.xy) * uPush;                 // the field travels along its own velocity
    vec3 n1 = gnoise(px * uNoiseScale * (1.0 - low.xy));
    vec2 n2 = gnoise(px * uNoiseScale * (2.0 - low.xy * (0.5 + n1.x)) + n1.yz * 0.1).yz;
    push += n2 * (low.z + low.w) * uNoiseAmt;           // churn where the paint is thick

    vec4 d = texture2D(uPrev, vUv + push * uTexel);
    d.xy -= 0.5;
    vec4 delta = (vec4(uFade.xx, uFade.yz) - 1.0) * d;
    delta += vec4(uVel * stamp, rw.yy * stamp);
    delta.zw = sign(delta.zw) * max(vec2(0.004), abs(delta.zw)); // weight always drains a little
    d += delta;
    d.xy += 0.5;
    gl_FragColor = clamp(d, 0.0, 1.0);
  }`;

const DOWN = /* glsl */ `
  precision highp float;
  varying vec2 vUv;
  uniform sampler2D uSrc; uniform vec2 uTexel;
  void main() {
    vec4 c = texture2D(uSrc, vUv + uTexel * vec2(-1.0, -1.0)) + texture2D(uSrc, vUv + uTexel * vec2(1.0, -1.0))
           + texture2D(uSrc, vUv + uTexel * vec2(-1.0, 1.0)) + texture2D(uSrc, vUv + uTexel * vec2(1.0, 1.0));
    gl_FragColor = c * 0.25;
  }`;

export const PAINT = {
  scale: 0.25,          // paint texture = 1/4 of the viewport
  radius: 1.8,          // capsule radius in paint px while the cursor moves
  push: 25,
  fade: [0.975, 0.95, 0.8],
  noiseScale: 0.02,
  noiseAmt: 3,
  velScale: 1 / 30,     // css px per 60 Hz frame -> stored velocity (saturates on a brisk move)
  // composite
  // measured 10 for the tint; 28 here because the stored velocity in this rebuild saturates lower
  amount: 3, multiplier: 5, rgbShift: 0.5, colorMultiplier: 28, shade: 1.25,
};

export function createPaint(renderer) {
  const cam = new THREE.OrthographicCamera(-1, 1, 1, -1, 0, 1);
  const quad = new THREE.Mesh(new THREE.PlaneGeometry(2, 2));
  const scene = new THREE.Scene(); scene.add(quad);
  const opts = { type: THREE.HalfFloatType, minFilter: THREE.LinearFilter, magFilter: THREE.LinearFilter, depthBuffer: false };
  let a, b, low1, low, W = 1, H = 1;

  const update = new THREE.ShaderMaterial({
    vertexShader: VERT, fragmentShader: UPDATE, depthTest: false, depthWrite: false,
    uniforms: {
      uPrev: { value: null }, uLow: { value: null }, uTexel: { value: new THREE.Vector2() },
      uFrom: { value: new THREE.Vector4() }, uTo: { value: new THREE.Vector4() }, uVel: { value: new THREE.Vector2() },
      uPush: { value: PAINT.push }, uFade: { value: new THREE.Vector3(...PAINT.fade) },
      uNoiseScale: { value: PAINT.noiseScale }, uNoiseAmt: { value: PAINT.noiseAmt }, uTime: { value: 0 },
    },
  });
  const down = new THREE.ShaderMaterial({
    vertexShader: VERT, fragmentShader: DOWN, depthTest: false, depthWrite: false,
    uniforms: { uSrc: { value: null }, uTexel: { value: new THREE.Vector2() } },
  });

  // three's clear() premultiplies by alpha, which would zero the neutral 0.5; fill with a shader instead
  const fill = new THREE.ShaderMaterial({
    vertexShader: VERT, fragmentShader: "void main(){ gl_FragColor = vec4(0.5, 0.5, 0.0, 0.0); }", depthTest: false, depthWrite: false,
  });
  function clearTo(rt) {
    const prev = renderer.getRenderTarget();
    quad.material = fill; renderer.setRenderTarget(rt); renderer.render(scene, cam);
    renderer.setRenderTarget(prev);
  }
  function resize(w, h) {
    W = Math.max(2, Math.round(w * PAINT.scale)); H = Math.max(2, Math.round(h * PAINT.scale));
    for (const t of [a, b, low1, low]) t && t.dispose();
    a = new THREE.WebGLRenderTarget(W, H, opts); b = new THREE.WebGLRenderTarget(W, H, opts);
    // the field pushes itself along a heavily blurred copy: a thin stroke keeps its full velocity
    // for the smear and the tint but only nudges itself forward
    low1 = new THREE.WebGLRenderTarget(Math.max(2, W >> 2), Math.max(2, H >> 2), opts);
    low = new THREE.WebGLRenderTarget(Math.max(2, W >> 3), Math.max(2, H >> 3), opts);
    clearTo(a); clearTo(b); clearTo(low1); clearTo(low);
  }

  // from/to: css px (top-left origin); moving: whether the cursor moved this frame; velCss: css px per 60 Hz frame
  function step(from, to, moving, velCss, cssH) {
    const s = PAINT.scale, r = moving ? PAINT.radius : 0;
    quad.material = down;
    down.uniforms.uSrc.value = a.texture; down.uniforms.uTexel.value.set(1 / W, 1 / H);
    renderer.setRenderTarget(low1); renderer.render(scene, cam);
    down.uniforms.uSrc.value = low1.texture; down.uniforms.uTexel.value.set(1 / low1.width, 1 / low1.height);
    renderer.setRenderTarget(low); renderer.render(scene, cam);

    const u = update.uniforms;
    u.uPrev.value = a.texture; u.uLow.value = low.texture; u.uTexel.value.set(1 / W, 1 / H);
    u.uFrom.value.set(from[0] * s, (cssH - from[1]) * s, r, 1);
    u.uTo.value.set(to[0] * s, (cssH - to[1]) * s, r, 1);
    u.uVel.value.set(velCss[0] * PAINT.velScale, -velCss[1] * PAINT.velScale);
    quad.material = update; renderer.setRenderTarget(b); renderer.render(scene, cam);
    const t = a; a = b; b = t;
  }

  return {
    resize, step,
    get texture() { return a.texture; },
    get target() { return a; },
    get texel() { return [1 / W, 1 / H]; },
  };
}
