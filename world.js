import * as THREE from "three";
import { buildJackGeometry } from "./jack.js";
import { createPaint, PAINT } from "./paint.js";
import { createPile, PHYS, A, RC } from "./physics.js";

/* Full-page WebGL: page colour + rounded card + 3D jacks (rendered to a target), then one composite pass
   that smears everything along the cursor's paint velocity and tints the fast, thinning parts of the trail. */

function mulberry32(a) {
  return function () {
    a |= 0; a = (a + 0x6d2b79f5) | 0;
    let t = Math.imul(a ^ (a >>> 15), 1 | a);
    t = (t + Math.imul(t ^ (t >>> 7), 61 | t)) ^ t;
    return ((t ^ (t >>> 14)) >>> 0) / 4294967296;
  };
}

// dark studio with long strip lights: gives the sharp bar highlights seen on the glossy pieces
function studioEnvironment() {
  const env = new THREE.Scene();
  const room = new THREE.Mesh(new THREE.BoxGeometry(30, 30, 30), new THREE.MeshBasicMaterial({ color: new THREE.Color(0.012, 0.013, 0.018), side: THREE.BackSide }));
  env.add(room);
  const strip = (w, h, x, y, z, ry, rz, k) => {
    const m = new THREE.Mesh(new THREE.PlaneGeometry(w, h), new THREE.MeshBasicMaterial({ color: new THREE.Color(k, k, k * 1.02), side: THREE.DoubleSide }));
    m.position.set(x, y, z); m.lookAt(0, 0, 0); m.rotateZ(rz); env.add(m);
  };
  strip(14, 1.1, -6, 10, 7, 0, 0.5, 9);     // key strip, upper left front
  strip(10, 0.6, 9, 6, 4, 0, -0.9, 5);      // right strip
  strip(16, 0.5, 0, 12, -4, 0, 0, 4);       // top back
  strip(18, 9, -2, 13, 2, 0, 0, 0.55);      // big soft overhead panel
  strip(12, 0.5, -10, -2, 6, 0, 1.3, 2.2);  // low left kicker
  return env;
}

const COMPOSITE_FRAG = /* glsl */ `
  precision highp float;
  varying vec2 vUv;
  uniform sampler2D tScene, tPaint;
  uniform vec2 uRes, uPaintTexel;
  uniform vec4 uCard;      // x, y, w, h in CSS px (top-left origin)
  uniform float uRadius, uTime, uFluid;
  uniform float uAmount, uMultiplier, uRgbShift, uColorMultiplier, uShade;

  vec3 toLinear(vec3 c) { return pow(c, vec3(2.2)); }
  vec3 toSRGB(vec3 c) {
    c = max(c, 0.0);
    return mix(c * 12.92, 1.055 * pow(c, vec3(1.0 / 2.4)) - 0.055, step(0.0031308, c));
  }
  float sdRoundRect(vec2 p, vec2 hs, float r) { vec2 q = abs(p) - hs + r; return length(max(q, 0.0)) + min(max(q.x, q.y), 0.0) - r; }

  // the undistorted page at uv (y up), in sRGB
  vec3 page(vec2 uv) {
    vec2 p = vec2(uv.x * uRes.x, (1.0 - uv.y) * uRes.y);
    vec2 c = uCard.xy + uCard.zw * 0.5;
    float d = sdRoundRect(p - c, uCard.zw * 0.5, uRadius);
    vec3 pageCol = vec3(240.0, 241.0, 250.0) / 255.0;
    if (d > 1.0) return pageCol;
    vec2 cu = (p - uCard.xy) / uCard.zw;
    float g = length((cu - vec2(0.6, 0.5)) / vec2(0.75, 0.95));
    vec3 bg = mix(vec3(0.108, 0.112, 0.128), vec3(0.082, 0.085, 0.096), smoothstep(0.0, 0.55, g));
    bg = mix(bg, vec3(0.066, 0.068, 0.078), smoothstep(0.55, 1.0, g));
    vec4 s = texture2D(tScene, vec2(cu.x, 1.0 - cu.y));
    vec3 col = toSRGB(s.rgb + toLinear(bg) * (1.0 - s.a));
    return mix(col, pageCol, clamp(d + 0.5, 0.0, 1.0));
  }

  float hash12(vec2 p) { vec3 p3 = fract(vec3(p.xyx) * 0.1031); p3 += dot(p3, p3.yzx + 33.33); return fract((p3.x + p3.y) * p3.z); }

  void main() {
    vec2 uv = vUv;
    vec3 col;
    if (uFluid > 0.5) {
      vec4 data = texture2D(tPaint, uv);
      float weight = (data.z + data.w) * 0.5;
      vec2 vel = (0.5 - data.xy - 0.001) * 2.0 * weight;
      // directional smear: 9 taps along the paint velocity, start jittered per pixel to hide banding
      vec2 stepUv = vel * uAmount / 4.0 * uPaintTexel * uMultiplier;
      vec2 jitter = vec2(hash12(gl_FragCoord.xy + fract(uTime * 7.0) * 97.0), hash12(gl_FragCoord.yx * 1.31 + fract(uTime * 5.0) * 53.0));
      vec2 suv = uv + jitter * stepUv;
      col = vec3(0.0);
      for (int i = 0; i < 9; i++) { col += page(suv); suv += stepUv; }
      col /= 9.0;
      // oily tint: hue follows the velocity, strongest where the trail is fast but thinning
      col += sin(vec3(vel.x + vel.y) * 40.0 + vec3(0.0, 2.0, 4.0) * uRgbShift)
           * smoothstep(0.4, -0.9, weight) * uShade * max(abs(vel.x), abs(vel.y)) * uColorMultiplier;
    } else {
      col = page(uv);
    }
    // film grain inside the card
    vec2 p = vec2(uv.x * uRes.x, (1.0 - uv.y) * uRes.y);
    float inCard = step(sdRoundRect(p - (uCard.xy + uCard.zw * 0.5), uCard.zw * 0.5, uRadius), 0.0);
    col += (fract(sin(dot(gl_FragCoord.xy + fract(uTime) * 61.0, vec2(12.9898, 78.233))) * 43758.5453) - 0.5) * 0.035 * inCard;
    gl_FragColor = vec4(col, 1.0);
  }`;

export function createWorld({ canvas, visual, freeze }) {
  const rand = mulberry32(20240607);
  const DPR = Math.min(devicePixelRatio || 1, 1.25); // ~11 ms/frame at DPR 1 on a GTX 1650
  const renderer = new THREE.WebGLRenderer({ canvas, antialias: false, alpha: false, powerPreference: "high-performance" });
  renderer.setPixelRatio(DPR);
  renderer.toneMapping = THREE.NoToneMapping;
  renderer.shadowMap.enabled = true;
  renderer.shadowMap.type = THREE.PCFSoftShadowMap;
  renderer.transmissionResolutionScale = 0.5; // the frosted pieces refract a blurred copy anyway
  renderer.autoClear = true;

  /* ---------- 3D scene: camera, light and materials measured on the reference ---------- */
  const scene = new THREE.Scene();
  const pmrem = new THREE.PMREMGenerator(renderer);
  scene.environment = pmrem.fromScene(studioEnvironment(), 0.02).texture;

  // reference camera: z 17.5, vertical fov 19.64° over the whole viewport, origin projected at the card's centre
  const camera = new THREE.PerspectiveCamera(19.64, 1.6, 0.5, 60);
  camera.position.set(0, 0, 17.5);

  // reference light position (10, 10, 5)
  const key = new THREE.DirectionalLight(0xffffff, 1.9);
  key.position.set(10, 10, 5);
  key.castShadow = true;
  key.shadow.mapSize.set(2048, 2048);
  Object.assign(key.shadow.camera, { left: -6, right: 6, top: 6, bottom: -6, near: 4, far: 26 });
  key.shadow.bias = -0.0005; key.shadow.normalBias = 0.03; key.shadow.radius = 4;
  scene.add(key);
  const fill = new THREE.DirectionalLight(0xdfe4ff, 0.45); fill.position.set(-8, 3, 6); scene.add(fill);
  scene.add(new THREE.HemisphereLight(0xf2f4ff, 0x14161c, 0.6)); // flatter, matcap-like fill as on the reference

  const jackGeo = buildJackGeometry(96);

  // contact occlusion from neighbouring jacks: every body is three capsules (half-length A, radius RC);
  // each fragment is darkened by the capsules of the other bodies that hem it in
  const shared = {
    uBodyPos: { value: Array.from({ length: PHYS.count }, () => new THREE.Vector3(0, 0, -99)) },
    uBodyAx: { value: Array.from({ length: PHYS.count * 3 }, () => new THREE.Vector3()) },
  };
  function withNeighbourAO(mat, aoStrength = 1) {
    mat.onBeforeCompile = (sh) => {
      sh.uniforms.uBodyPos = shared.uBodyPos; sh.uniforms.uBodyAx = shared.uBodyAx;
      sh.uniforms.uSelf = mat.userData.uSelf; sh.uniforms.uAOStrength = { value: aoStrength };
      sh.vertexShader = sh.vertexShader
        .replace("#include <common>", "#include <common>\nattribute float bakedAO; varying float vBakedAO; varying vec3 vWPos; varying vec3 vWNrm;")
        .replace("#include <worldpos_vertex>", "#include <worldpos_vertex>\nvBakedAO = bakedAO; vWPos = (modelMatrix * vec4(transformed, 1.0)).xyz; vWNrm = normalize(mat3(modelMatrix) * objectNormal);");
      sh.fragmentShader = sh.fragmentShader
        .replace("#include <common>", `#include <common>
          #define NB ${PHYS.count}
          uniform vec3 uBodyPos[NB]; uniform vec3 uBodyAx[NB * 3]; uniform int uSelf; uniform float uAOStrength;
          varying float vBakedAO; varying vec3 vWPos; varying vec3 vWNrm;
          float capsuleOcclusion(vec3 p, vec3 n, vec3 c, vec3 ax) {
            vec3 a0 = c - ax, ba = 2.0 * ax;
            float h = clamp(dot(p - a0, ba) / dot(ba, ba), 0.0, 1.0);
            vec3 d = a0 + ba * h - p;
            float l = max(length(d), 1e-3);
            float r = ${RC.toFixed(4)};
            return clamp(dot(n, d / l) * (r * r) / (l * l) * 1.6, 0.0, 1.0);
          }
          float neighbourAO(vec3 p, vec3 n) {
            float ao = 1.0;
            for (int i = 0; i < NB; i++) {
              if (i == uSelf) continue;
              vec3 c = uBodyPos[i];
              if (distance(c, p) > 2.6) continue;
              for (int k = 0; k < 3; k++) ao *= 1.0 - capsuleOcclusion(p, n, c, uBodyAx[i * 3 + k]);
            }
            return ao;
          }`)
        .replace("#include <aomap_fragment>", `#include <aomap_fragment>
          float occ = mix(1.0, neighbourAO(vWPos, normalize(vWNrm)) * vBakedAO, uAOStrength);
          reflectedLight.indirectDiffuse *= occ;
          reflectedLight.directDiffuse *= mix(1.0, occ, 0.55);
          reflectedLight.indirectSpecular *= occ;`);
    };
    mat.customProgramCacheKey = () => "nbao" + aoStrength;
    return mat;
  }

  // the reference's 25 jacks: colour (sRGB) and roughness per body, read from its draw calls
  const srgb = (r, g, b) => new THREE.Color().setRGB(r, g, b, THREE.SRGBColorSpace);
  const KINDS = {
    whiteMatte: () => new THREE.MeshPhysicalMaterial({ color: 0xc9c9cd, roughness: 0.72, envMapIntensity: 0.5 }),
    whiteGloss: () => new THREE.MeshPhysicalMaterial({ color: 0xd6d6da, roughness: 0.18, clearcoat: 0.6, clearcoatRoughness: 0.08, envMapIntensity: 0.9 }),
    greyGloss: () => new THREE.MeshPhysicalMaterial({ color: 0xcfcfd3, roughness: 0.15, clearcoat: 0.6, clearcoatRoughness: 0.08, envMapIntensity: 0.9 }),
    blackMatte: () => new THREE.MeshPhysicalMaterial({ color: 0x0b0b0c, roughness: 0.8, sheen: 0.25, sheenRoughness: 0.5, sheenColor: 0x22242c, envMapIntensity: 0.35 }),
    blackGloss: () => new THREE.MeshPhysicalMaterial({ color: 0x111111, roughness: 0.12, clearcoat: 1, clearcoatRoughness: 0.04, envMapIntensity: 1.0 }),
    blueMatte: () => new THREE.MeshPhysicalMaterial({ color: srgb(0.06, 0.15, 0.99), roughness: 0.8, sheen: 0.9, sheenRoughness: 0.45, sheenColor: 0x5560ff, envMapIntensity: 0.45 }),
    blueGloss: () => new THREE.MeshPhysicalMaterial({ color: srgb(0.024, 0.114, 0.984), roughness: 0.14, clearcoat: 1, clearcoatRoughness: 0.04, envMapIntensity: 1.0 }),
    // the two lavender jacks are frosted glass on the reference (they refract a blurred copy of the scene, ior 2.4)
    lavenderGlass: (rough) => new THREE.MeshPhysicalMaterial({ color: srgb(0.616, 0.651, 0.992), roughness: rough, transmission: 1, thickness: 0.9, ior: 2.4, iridescence: 0.12, iridescenceIOR: 1.5, envMapIntensity: 0.8 }),
  };
  const ROSTER = [
    ...Array(6).fill("blackMatte"), ...Array(3).fill("blackGloss"),
    ...Array(6).fill("whiteMatte"), ...Array(2).fill("whiteGloss"), "greyGloss",
    ...Array(3).fill("blueMatte"), ...Array(2).fill("blueGloss"),
    "lavenderGlass:0.12", "lavenderGlass:0.55",
  ];
  // shuffle deterministically so colours are spread through the pile
  for (let i = ROSTER.length - 1; i > 0; i--) { const j = Math.floor(rand() * (i + 1)); [ROSTER[i], ROSTER[j]] = [ROSTER[j], ROSTER[i]]; }

  const pile = createPile(7);
  const meshes = pile.bodies.map((b, i) => {
    const [kind, arg] = ROSTER[i].split(":");
    const mat = KINDS[kind](arg !== undefined ? +arg : undefined);
    mat.userData.uSelf = { value: i };
    withNeighbourAO(mat, kind === "lavenderGlass" ? 0.5 : 1);
    const mesh = new THREE.Mesh(jackGeo, mat);
    mesh.castShadow = true; mesh.receiveShadow = true;
    scene.add(mesh);
    return mesh;
  });
  function syncMeshes() {
    pile.bodies.forEach((b, i) => {
      const m = meshes[i];
      m.position.set(b.p[0], b.p[1], b.p[2]);
      m.quaternion.set(b.q[0], b.q[1], b.q[2], b.q[3]);
      shared.uBodyPos.value[i].set(b.p[0], b.p[1], b.p[2]);
      for (let k = 0; k < 3; k++) {
        const e = [0, 0, 0]; e[k] = A;
        shared.uBodyAx.value[i * 3 + k].set(e[0], e[1], e[2]).applyQuaternion(m.quaternion);
      }
    });
  }

  /* ---------- pointer ---------- */
  const pointer = { x: -1, y: -1, has: false, moved: false, ndc: new THREE.Vector2(), at: new THREE.Vector3(), prevAt: null };
  addEventListener("pointermove", (e) => { pointer.x = e.clientX; pointer.y = e.clientY; pointer.moved = true; pointer.has = true; }, { passive: true });
  document.addEventListener("pointerleave", () => { pointer.has = false; });
  const raycaster = new THREE.Raycaster();
  const zPlane = new THREE.Plane(new THREE.Vector3(0, 0, 1), 0);

  /* ---------- physics (physics.js: tuned against the reference's recorded pile) ---------- */
  function physics(dt) {
    if (dt <= 0) return;
    updatePointer(dt);
    pile.step(dt);
    syncMeshes();
  }

  /* ---------- render targets, fluid, composite ---------- */
  const sceneRT = new THREE.WebGLRenderTarget(4, 4, { type: THREE.HalfFloatType, samples: 4 });
  const paint = createPaint(renderer);
  const comp = new THREE.ShaderMaterial({
    vertexShader: `varying vec2 vUv; void main(){ vUv = uv; gl_Position = vec4(position.xy, 0.0, 1.0); }`,
    fragmentShader: COMPOSITE_FRAG, depthTest: false, depthWrite: false,
    uniforms: {
      tScene: { value: sceneRT.texture }, tPaint: { value: null },
      uRes: { value: new THREE.Vector2() }, uPaintTexel: { value: new THREE.Vector2() }, uCard: { value: new THREE.Vector4() },
      uRadius: { value: 20 }, uTime: { value: 0 }, uFluid: { value: 0 },
      uAmount: { value: PAINT.amount }, uMultiplier: { value: PAINT.multiplier }, uRgbShift: { value: PAINT.rgbShift },
      uColorMultiplier: { value: PAINT.colorMultiplier }, uShade: { value: PAINT.shade },
    },
  });
  const compScene = new THREE.Scene();
  const compCam = new THREE.OrthographicCamera(-1, 1, 1, -1, 0, 1);
  compScene.add(new THREE.Mesh(new THREE.PlaneGeometry(2, 2), comp));

  let W = 1, H = 1, card = { x: 0, y: 0, w: 1, h: 1 };
  function resize() {
    W = innerWidth; H = innerHeight;
    renderer.setSize(W, H, false);
    const r = visual.getBoundingClientRect();
    card = { x: r.left, y: r.top, w: r.width, h: r.height };
    sceneRT.setSize(Math.round(card.w * DPR), Math.round(card.h * DPR));
    // full-viewport projection like the reference, shifted so the origin sits at the card's centre; draw only the card window
    camera.aspect = W / H;
    camera.setViewOffset(W, H, card.x, card.y - (card.y + card.h / 2 - H / 2), card.w, card.h);
    camera.updateProjectionMatrix();
    comp.uniforms.uRes.value.set(W, H);
    comp.uniforms.uCard.value.set(card.x, card.y, card.w, card.h);
    paint.resize(W, H);
    comp.uniforms.uPaintTexel.value.set(...paint.texel);
  }
  resize();
  addEventListener("resize", resize);
  syncMeshes();

  // the cursor is a ray from the camera through the pointer; its velocity is measured where it crosses z = 0
  function updatePointer(dt) {
    const c = pile.cursor;
    c.active = pointer.has;
    if (!pointer.has) { pointer.prevAt = null; return; }
    pointer.ndc.set(((pointer.x - card.x) / card.w) * 2 - 1, -(((pointer.y - card.y) / card.h) * 2 - 1));
    raycaster.setFromCamera(pointer.ndc, camera);
    const r = raycaster.ray;
    c.o = [r.origin.x, r.origin.y, r.origin.z]; c.d = [r.direction.x, r.direction.y, r.direction.z];
    r.intersectPlane(zPlane, pointer.at);
    if (pointer.prevAt && dt > 0) {
      const k = Math.min(1, dt * 30); // light smoothing of the measured velocity
      for (let i = 0; i < 3; i++) c.v[i] += (((pointer.at.getComponent(i) - pointer.prevAt.getComponent(i)) / dt) - c.v[i]) * k;
    } else c.v = [0, 0, 0];
    pointer.prevAt = (pointer.prevAt || new THREE.Vector3()).copy(pointer.at);
    pointer.moved = false;
  }

  // the paint runs on a fixed 60 Hz step: its fade constants are per frame on the reference
  let paintAcc = 0;
  const stamp = { x: 0, y: 0, ok: false };
  function stepPaint(dt) {
    paintAcc = Math.min(paintAcc + dt, 3 / 60);
    while (paintAcc >= 1 / 60) {
      paintAcc -= 1 / 60;
      const cur = pointer.has ? [pointer.x, pointer.y] : [stamp.x, stamp.y];
      const prev = stamp.ok ? [stamp.x, stamp.y] : cur;
      const v = [cur[0] - prev[0], cur[1] - prev[1]];
      const moving = pointer.has && (v[0] !== 0 || v[1] !== 0);
      paint.step(prev, cur, moving, v, H);
      stamp.x = cur[0]; stamp.y = cur[1]; stamp.ok = pointer.has;
    }
  }

  let fluidStarted = false;
  function render(dt, tSec, { drawScene = true, fluidOn = true } = {}) {
    if (drawScene) {
      renderer.setRenderTarget(sceneRT);
      renderer.setClearColor(0x000000, 0);
      renderer.clear();
      renderer.render(scene, camera);
    }
    if (fluidOn && freeze === null) { stepPaint(dt || 1 / 60); fluidStarted = true; }
    comp.uniforms.uFluid.value = fluidStarted ? 1 : 0;
    comp.uniforms.tPaint.value = paint.texture;
    comp.uniforms.uTime.value = tSec;
    renderer.setRenderTarget(null);
    renderer.render(compScene, compCam);
  }

  function compile() { renderer.compile(scene, camera); renderer.compile(compScene, compCam); }

  return { physics, render, compile, paint, comp, pile, meshes, camera, pointer, renderer };
}
