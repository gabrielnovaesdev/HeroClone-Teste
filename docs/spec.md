# lusion-hero motion spec

Target: https://lusion.co/ — first section `#home-hero` (loader intro → hero reveal), viewport 1440x900, trigger load
Destination: `clone/index.html` (standalone HTML + three.js r158 from CDN, no build step)
Fidelity: pixel-faithful as far as allowed — motion, layout, sizes, colours and type matched; the studio's own
3D models, shaders, logo SVG and Aeonik font are NOT copied (they belong to the studio): geometry is rebuilt
procedurally, font falls back to a close grotesk, logo is set as text.

Reference capture: `.reanimate/lusion-hero/ref`
`node capture.ts --url https://lusion.co/ --out ref --viewport 1440x900 --trigger load --wait-before 0 --duration 12000 --fps 10 --clock virtual --network-wait 8000 --track "#header, #header-logo, #header-right-talk-btn, #header-right-menu-btn, canvas#canvas"`

## Structure (static, at rest, from the live DOM)
| element | selector | box (x,y,w,h) | notes |
|---|---|---|---|
| page bg | body / canvas | 0,0,1440,900 | rgb(240,241,250) |
| header | #header | padding 50px 72px | fixed |
| logo | #header-logo | 72,59,120,24 | black wordmark |
| title | #home-hero-title h1 | 403,50,523,119 | 36px / 39.6px, 3 lines, split .line > .word |
| sound btn | #header-right-sound-btn | 1053,50,45,45 | round, bg rgb(228,230,239), dash icon |
| talk btn | #header-right-talk-btn | 1116,50,134,45 | bg rgb(43,46,58), white 14px/500 uppercase, radius 87.5px |
| menu btn | #header-right-menu-btn | 1266,50,102,45 | bg rgb(228,230,239), black 14px/500 uppercase |
| visual card | #home-hero-visual-container | 72,199,1296,651 | drawn in WebGL: dark rounded rect + 3D jacks |
| scroll row | #home-hero-scroll-container | 72,850,1296,50 | 4 crosses 14px at x=72,497,929,1354, y=868 |
| scroll text | #home-hero-scroll | centred at 720,875 | 14.4px/500 uppercase "SCROLL TO EXPLORE" |

## Timeline (t = 0 at navigation; reference captured on a virtual clock at 10 fps; network looks instant)
| # | element | property | from → to | start ms | duration ms | easing | stagger | source |
|---|---|---|---|---|---|---|---|---|
| 1 | loader track | appear | – → #333 210x42 @ (616,430) | 100 | 0 | step | – | frames 0–1 |
| 2 | loader fill | width | 0 → 210 px | 100 | 1900 | measured table (fast to 84 % at 1200, then slow) | – | pixel scan f2–f20 |
| 3 | counter (bottom-left, ~118px, baseline = viewport bottom) | value | 000 → 100, digits roll up | 100 | 1900 | follows fill | carry rolls | frames |
| 4 | bar | split | one bar → left 60 % + right 40 % | 2100 | 420 | easeInOutCubic | – | rows scan f20–f28 |
| 5 | left piece | rotate / move | 0 → +90°, centre (679,451) → (678.5,432) | 2100 | 420 | easeInOutCubic | – | rows scan |
| 6 | right piece | move | centre (783.5,451) → (741.5,513) | 2100 | 420 | easeInOutCubic | – | rows scan |
| 7 | L windows | scale / rotate / skewX about (674,476) | 1 → 70, 0 → 18°, 0 → -28° | 2900 | 600 | accelerating table (×2.4 per 100 ms) | – | frames f29–f35 |
| 8 | white veil over hero | opacity | 1 → 0 | 3100 | 500 | table (.93/.67/.20/.04) | – | pixel samples |
| 9 | sound / talk / menu chips | translateY | 56 → 0 px | 3740 | 813 | cubic-bezier(0.2,0,0,1) | +100 ms | track.json + easing.ts |
| 10 | title words (14) | translateY | 61.2 → 0 px | 3860 | 1000 | cubic-bezier(0.2,0,0,1) | +50 ms per word, across lines | ref-words/track.json |
| 11 | title words | rotate | 15° → 0 | 3860 | 708 | cubic-bezier(0.2,0,0,1) | same | ref-words/track.json |
| 12 | crosses (4) | rotate, scale | 0 → 180°, 0 → 1 | 4060 | 580 | cubic-bezier(0.2,0,0,1) | none | ref-words/track.json |
| 13 | scroll words (3) | scale, opacity | 0.8 → 1, 0 → 1 | 4100 | 580 | cubic-bezier(0.2,0,0,1) | +100 ms | ref-words/track.json |
| 14 | 3D jacks | position / rotation | slow drift + spin, pointer pushes | always | – | physics (spring to home, damping) | – | frames f35–f120 |

Total length of the intro: 5367 ms (last title word settles). Lines are clipped (`overflow: hidden`), so words rise into view.

## Style facts
- Page rgb(240,241,250); card rgb(21,22,24), radius 20px; chips rgb(228,230,239) / rgb(43,46,58).
- Title 36px / 39.6px; chips 14px/500 uppercase; scroll text 14.4px/500 uppercase.
- Font: reference uses Aeonik (licensed) → clone uses Inter Tight from Google Fonts.
- 3D: 5 materials — blue gloss, blue velvet, grey-white gloss, grey-white matte, black gloss; hollow six-armed tubes.
  The reference's models and shaders are not copied; the geometry is rebuilt procedurally with three.js r158.
