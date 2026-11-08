# Flying Reveal

Flying is a Ball-local, procedural wind effect on the existing 3.5-second timeline. It retains the night-sky background, renderer, card rotation and shared `CardTransformation`. There is no additional render loop, bloom pass, fluid simulation or replay download.

## Reuse and new parts

- `ribbonGeometry.ts` extracts Grass's existing indexed strip generator, including the original 96-by-4 subdivision defaults, attributes, indices and bounds. Grass uses the same data and shaders. Psychic remains unchanged; its expanding spiral, soft edge and height-reveal approach informs Flying.
- `FlyingEffect` owns one open funnel surface, a combined ribbon mesh and instanced feather geometry. Desktop has three main/three fine strands and six feathers; mobile has two main/two fine strands and four feathers. The two compositing passes share all three geometries and the one generated feather texture.
- `flyingMaterial.ts` shares a Ball-local wind field between funnel, ribbons, feather motion and highlights. Radius grows with height; the axis and outline bend smoothly. Shader structure travels upwards as well as around the axis. The entire effect is not a rotating rigid mesh.
- Highlight packets follow the ribbon paths, grow and stretch along the flow, then fade. Their broad component also lights the funnel; their narrow component is nearly white. This contrast is present in the materials without postprocessing. The core wind remains visible without feathers.

## Timing and rendering

| Seconds | State |
| --- | --- |
| 0–0.4 | Small source, first wind and feather. |
| 0.4–0.8 | Funnel grows upwards and outwards. |
| 0.8–1.45 | Full tornado and travelling light packets. |
| 1.45–2.15 | Shared card silhouette forms; source and foreground wind weaken. |
| 2.15–2.85 | Artwork fades in, clearing the center before the sides and rear. |
| 2.85–3.5 | Last air and feather fade; the shared card edge glow remains. |

The Ball uses the existing 0.8-second opening. Final card scale is 0.94, y=0.37, z=0.50; its rotation timings are unchanged. All wind positions are local to the GLB root, and the host transforms the fill light from that space each frame.

The card remains transparent while its artwork appears. Flying therefore draws two complementary passes: fragments behind the actual card outline before the card, and other fragments after it. A camera ray is intersected with the near card face in card-local coordinates, using the current card/world matrices and rounded outline. This avoids a fixed world-z partition as the card rotates. Both passes test the Ball's existing depth and write no depth. Feather alpha uses normal blending; air and light use additive blending with soft edges. The face approximation uses the card's 0.02 thickness; it is not a general solid-mesh intersection solver.

Time-dependent poses and packets are analytic functions of the host's absolute time. GPU buffers, materials and uniform objects are created once; update and onBeforeRender allocate no objects. `reset`, `finish`, type switching and idempotent disposal follow the existing scene lifecycle. Reduced motion immediately exposes the completed card. The effect has no independent async preparation to survive cancellation.

## Selection and preview

`RevealType` and `RevealPalette` include `flying`; the `PokemonRevealEffect` interface is unchanged. `?reveal=flying` selects a development preview with local Pidgeotto artwork. Normal search still uses the actual selected TCGdex card.

`flyingSpecies.ts` is a local National Dex/name/form lookup verified against https://pokeapi.co/api/v2/type/flying on 2026-11-08. Alternate-form resource IDs are not mistaken for National Dex IDs. Named Sky Shaymin, Fan Rotom and Flying Mega forms are handled separately; Galarian Farfetch'd, Mega Charizard X and Mega Gyarados are excluded. No PokeAPI request is made during playback.

Existing Poison, Ice, Ground, Fighting, Electric, Grass, Fire and Water rules take precedence. Explicit Psychic cards and the existing regional Psychic overrides retain Psychic. Only then can a Flying species replace the generic fallback. Colorless energy alone never selects Flying.

## Verification

Start `pnpm dev`, then run `pnpm test:flying --motion`. `FLYING_BASE_URL` overrides the development server URL; `FLYING_QA_DIR` selects an artifact directory. Optional `FLYING_BASELINE_DIR` supplies pre-change `baseline-{psychic|grass}-{time}.png` frames at 1.05, 1.8, 2.4 and 3.5 seconds.

The test checks species/forms and priority, desktop/mobile counts, six storyboard stages and the completed state, front/side cameras, wind without feathers, black-background readability, rendered highlight contribution and motion, deterministic rewind, resource identity across restarts, interrupted type changes, resize, visibility, reduced motion, search form and disposal. Screenshots and 1×/0.2× canvas recordings support separate visual review. GSAP restores Euler values to six decimals, so pixel comparisons allow at most eight pixels differing by 5–16 channel levels; larger changes fail.

Full HD GPU timing is measured separately from recording. The 16.7 ms p95 assertion applies when GPU timer queries return samples; unsupported timers are reported. A mobile viewport is not a physical-phone benchmark. Form tests use deterministic API fixtures and do not certify external API availability.

`pnpm build` checks TypeScript and produces the Vite build. Sataku preparation/review records are under the canonical agent's ignored `.3d-workflow/flying-reveal`. Its parity/source harness expects `src/scripts/3D.js`, which this standalone Vite app does not have; application verification is not represented as a passed Sataku campaign harness.

### Results — 2026-11-08

- `pnpm build` passed (TypeScript and Vite). Vite retains the existing large-bundle advisory.
- `test:flying --motion` passed on both profiles without JavaScript or WebGL shader errors. Artifacts: `C:/Users/Ewa-komp/AppData/Local/Temp/flying-qa-1794157332111` (`report.json`, 32 stills, eight recordings and decoded video contact sheets).
- All four Psychic frames differed by at most one channel level. Grass differed by at most one channel level except for a single pixel differing by six levels at 1.05 seconds; this is within GSAP/raster precision. No visible change was found.
- Highlight-on/off rendering without feathers showed a moving contribution in both profiles. Between 0.85 and 0.93 seconds the contribution centroid rose by 23.25 pixels on desktop and 12.85 pixels on mobile. The maximum channel difference reached 232/228, confirming visible light accents independent of bloom.
- The 1× recordings lasted 3487–3500 ms; 0.2× recordings lasted 17498–17515 ms. Decoded nearby frames and six-stage contact sheets were inspected for both cameras/profiles: a widening funnel, upward-moving structure/light, feather flight, clearing card center and clean ending.
- Full-scene Full HD GPU timing: median 1.69 ms, p95 3.32 ms, 210 samples on this machine, measured without recording. This is not a physical mobile-device result.
- Restarts retained geometry/material identities and stable memory counters. Disposal left zero geometries and one renderer-owned texture, consistent with the existing Three.js environment resource.
- The built application was checked through its search form with deterministic TCGdex fixtures. Pidgeotto produced Flying; production had no debug handle, requested the selected API artwork, and loaded no smoke replay or local Pidgeotto preview asset.
