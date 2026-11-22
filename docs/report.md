# lusion-hero: relatório final (rodada 3)

Fidelidade: pixel-faithful na intro e na UI; motion-faithful na cena 3D (geometria e física recriadas do zero).
Código: clone/index.html + clone/main.js (HTML + three.js r158, sem build). Servidor: `node clone/serve.mjs` → http://127.0.0.1:5173/
Pré-visualização de um instante: http://127.0.0.1:5173/?t=3300 (congela o relógio da intro em 3,3 s).

| Região / elemento | Medida | Resultado |
|---|---|---|
| Intro inteira (0–3,2 s): loader, contador, divisão em L, início da expansão | mismatch por frame 0,2–0,8 % (2,7 % em 3,2 s) | PASS |
| Header + título (0–198 px) | mismatch médio 1,92 %, erro de timing 0 s | PASS |
| Linha "scroll to explore" + cruzes | mismatch médio 2,10 % | PASS (pixels) |
| Botões do header (translateY 56→0) | erro médio 0,85 px, máx 6 px | PASS |
| Timing do quadro inteiro | início 0 s, fim 0 s, pico 0 s | PASS |
| Card 3D (blur 8 px) | mismatch 48,95 % | FAIL esperado (ver abaixo) |

Desvios residuais
- Cena 3D: as peças, materiais e física da referência são do estúdio e não foram copiados; foram recriados (tubos de 6 braços, 5 materiais, pilha com mola + colisões). Densidade, escala, cores e ritmo de movimento batem a olho; posições exatas nunca vão bater → ~49 % de pixels diferentes no card.
- 3,3–3,4 s: o formato das janelas cisalhadas é aproximado (24 % no frame 33, que também mistura a cena 3D).
- Fonte: Aeonik (licenciada) substituída por Inter Tight → ~3,5 % dos pixels do título diferem, sem efeito na timing.
- Logo: texto em SVG, não o SVG original.

## Round 4 — from the user's screen recording (lusion.co in Brave, 34 s, mouse in use)

What the recording showed that the first build missed, and what changed:

| attribute | reference (recording) | before | now |
|---|---|---|---|
| object shape | thick round tubes, filleted joints, rounded rims, bore through each arm | three merged lathe tubes, hard joints | SDF jack (smooth union + rounded cylinders − bores) meshed with surface nets, gradient normals (`clone/jack.js`) |
| object scale | front piece ≈ 57 % of card height, compact ball, dark space around | ≈ 35 %, pile spread across the card | ≈ 50 %, near-isotropic spring → ball |
| materials / light | white satin + chalk, blue gloss with bar highlights, blue velvet, black gloss/velvet; strong key, soft shadows, depth falloff, film grain | RoomEnvironment, no shadows | strip-light studio PMREM, PCF soft shadows, fog falloff, grain in composite |
| idle motion | ≈ 10–15 °/s spin, slow drift | ≈ 150 °/s | 0.27 rad/s (≈ 15 °/s) measured |
| cursor on pieces | sweep scatters the ball, it regroups in ~4–6 s | small push | push scaled by cursor speed + velocity transfer + torque; spread back near rest in ~5 s |
| cursor visual | fluid ribbons: refraction, chromatic dispersion, oily rainbow rim, milky over the light page, card edge warps | none | stable-fluids sim (`clone/fluid.js`) + full-page composite (`clone/world.js`): page, card and 3D are all drawn in one WebGL canvas so the fluid can refract them |

Performance: one frame (scene + shadows + fluid + composite) 5.7 ms at 1440×900, DPR 1, GTX 1650; DPR capped at 1.5.
Side by side: `compare-4/ref-vs-clone.png` (top: idle, bottom: cursor trail; left reference, right clone).
Still different: the pieces' exact positions (own physics), the reference's slight depth-of-field blur on far pieces (not rebuilt), and the fluid's exact fine texture.

## Round 5 — cursor trail, re-measured on the live site

Method: drove lusion.co in a headed Chromium (real GPU) with Playwright mouse moves at fixed speeds (fast sweep ~2100 px/s,
medium ~640 px/s, brisk circle, sweep over the light page), recorded video, and logged the uniforms of the cursor passes
(`trail-ref2/uniforms.json`). The same script then recorded the clone (`trail-clone/`). Pairs: `compare-5/circle3.png`, `compare-5/sweep3.png`.

What the trail actually is (round 4 had it wrong: it was a fluid solver with lens refraction that lingered for seconds):
- a quarter-resolution "paint" field (360×225 at 1440×900): xy = velocity around 0.5, z/w = weight;
- each frame the cursor stamps a thin capsule (radius ≈1.8 paint px) from its previous to its current position; radius 0 when it stops;
- the field pushes itself along a blurred low-res copy of its own velocity (push 25), is churned by gradient noise
  (scale 0.02, strength 3) where it is thick, and fades per frame (velocity 0.975, weights 0.95 / 0.8, min drain 0.004);
- the post pass averages 9 jittered taps of the image along the paint velocity (amount 3, multiplier 5) → the pieces
  smear/“melt” along the stroke — and adds a hue that follows the velocity where the stroke is thinning (rgbShift 0.5, shade 1.25).
Result: slow moves leave almost nothing; brisk moves leave thin smeared streaks with an oily tint that vanish in ~0.3–0.5 s.

Clone (`clone/paint.js`, composite in `clone/world.js`): same mechanism, own code, measured constants, fixed 60 Hz step.
Deviations: velocity scale 1/30 css px per frame and tint ×28 (measured 10) because the stored velocity saturates lower in this
rebuild — tuned by eye against the paired frames; hue skews slightly cooler than the reference's orange/blue streaks.
Pieces: cursor push cut to ~⅓ (radius 1.7, speed gain 0.3) — on the live site the pile barely moves under the same sweeps.
Bug found on the way: three.js `clear()` premultiplies by alpha, so the neutral 0.5 velocity cleared to 0 and the whole screen
started with a false velocity; the field is now initialised with a fill shader.

## Round 6 — physics, cursor behaviour, rest/return and look, measured on the live reference

Method: hooked the reference's WebGL draw calls (headed Chromium, real GPU) and recorded, every frame, each jack's
position/radius/rotation/colour/roughness plus the camera and the light, while a fixed mouse script ran (6 s rest, fast sweep,
7 s rest, slow hover, 6 s rest, back-and-forth scrub, 8 s rest): `phys-ref/physics.json`, analysis in `phys-ref/analysis.txt`.

Facts read from the reference
- 25 jacks, all the same size; collision radius 1 (u_selfPositionRadius.w); shading models each as 3 capsules, tube radius 1/3 of the reach.
- Pair distances pile up hard at 2.0–2.1 and never below → they collide as spheres of radius ~1.05 (the crosses never nest).
- Camera z 17.5, vertical fov 19.64° over the whole viewport, projection shifted so the origin is at the card's centre. Light at (10, 10, 5).
- Materials (sRGB colour, roughness): 6 black matte, 3 black gloss, 6 white matte, 2 white gloss, 1 light-grey gloss, 3 blue matte,
  2 blue gloss, 2 lavender frosted glass (refract a blurred scene, ior 2.4). Shading adds contact occlusion/shadows from neighbours.
- Behaviour: rest spread 2.55 (mean distance to centroid), idle drift 0.18 u/s, idle spin 0.21 rad/s (0.5 s windows, axis persists);
  slow hover shoves the whole pile ~0.8 (it flows around the cursor, far pieces move too); fast sweep opens it to 3.7 and carries it ~2.0;
  back to rest ~1.9 s after the cursor leaves, slight overshoot.

Clone
- `clone/physics.js` (new): sphere contacts (spring-damper, Coulomb-capped friction, contact-point torque), pull to the origin,
  cursor = ray from the camera with a soft core that shoves and drags, per-jack idle spin + faint swirl. Tuned offline by replaying
  the reference's recorded mouse trajectory (`replay.mjs`) and matching chaos-robust features over 6 seeds:

  | feature | reference | clone (mean of 6 seeds) |
  |---|---|---|
  | rest spread | 2.55 | 2.56 |
  | idle drift / spin | 0.18 u/s / 0.21 rad/s | 0.16 / 0.24 |
  | slow-hover pile shift | 0.81 | 0.84 |
  | fast-sweep peak spread | 3.73 | 3.93 |
  | fast-sweep pile shift | 2.04 | 2.22 |
  | return to rest after the sweep | 1.90 s | 1.94 s |
  | scrub peak spread | 3.70 | 4.00 |

- `clone/world.js`: reference camera and light, measured material roster (lavender pieces use transmission), neighbour contact
  occlusion (each fragment darkened by the 3 capsules of every nearby jack) + occlusion baked into the mesh from the SDF.
- `clone/jack.js`: reach 1, tube radius 1/3. Scale verified by rendering the clone with a synchronised reference pose
  (`pose-ref/`): best pixel match at scale 1.00 (0.9–1.3 tried).
- Video comparison with the same mouse script: `compare-6/motion-final.png` (left reference, right clone). Motion energy: rest ~30–45
  vs ~40–55, strong motion after the sweep 2.3 s vs 1.7 s, back to rest ~4.5 s vs ~4.3 s.
- Cost: ~11 ms/frame at DPR 1 on a GTX 1650 (DPR capped at 1.25); physics 0.12 ms/frame.

Not matched: exact piece positions (chaotic system: same rules, different trajectory); the reference's matcap-based shading is
approximated with PBR + occlusion, so highlights and the frosted glass look close but not identical; scrub spread +8 %.
