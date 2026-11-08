# Fighting Reveal

Fighting uses the existing 3.5-second reveal clock, `CardTransformation`, MAC smoke solver, bounded replay worker and depth-aware volume renderer. Cards with TCG type `Fighting` select this effect after the existing Ice species/form overrides. `?reveal=fighting` is a development preview with the local Machop base1-52 artwork; production uses the selected TCGdex card.

## Sequence

| Seconds | Action |
| --- | --- |
| 0–0.55 | Small hot source, growing smoke and four trembling grains inside the bowl. |
| 0.55–0.85 | First release, independently timed streaks, sparks and earth fragments. |
| 0.85–1.45 | Strongest release around 1.02 s; all stone emission ends by 1.2 s. |
| 1.45–2.15 | Shared orb-to-card silhouette; source fades and debris continues its flight. |
| 2.15–2.85 | Card artwork appears with a Fighting-only ease-out curve; smoke rises beside/behind it. |
| 2.85–3.5 | Remaining smoke disperses; the card retains its red-orange outline glow. |

The Ball opens in 0.8 seconds. Final card pose uses scale 0.94, y=0.37 and z=0.50, matching Ice/Water. The model is intact; no model mesh becomes debris.

## Earth and energy

`FightingEffect` owns six instanced earth geometries, one shared rough nonmetallic material, transient curved ribbons and a spark draw. Desktop has 48 fragments and mobile 28; at most four have larger sizes. Three clump and three stone silhouettes have baked coordinate-based deformation, joined vertices, cavity colors and object-local grain. A seeded minority receives thin discontinuous emissive seams. Red illumination comes from the host's existing point light.

Each fragment has a fixed birth in 0.55–1.2 s, initial position/velocity, rotation axis and immutable scale. Position is `p0 + v*t + (0,-4.3,0)*t²/2`; rotation uses a quaternion about the assigned axis. Finished fragments move outside the scene without shrinking or recycling. Reverse seek recomputes poses from absolute time. No vectors, geometry or materials are allocated by the debris update.

Two short impulse envelopes drive the source, nearby smoke lighting and point light. Streaks have their own staggered births, chipped tapered outlines and 0.24-second lifetimes. Short packets travel outwards rather than leaving long curved bands attached to the source. Desktop/mobile use 280/150 sparks with varied sizes and 0.45–1.1-second lifetimes. Energy never contributes opaque depth; stones do.

## Smoke profiles and assets

`smokeProfile('ice' | 'fighting')` is shared by simulation, replay validation and export. Omitted profile remains Ice. Fighting changes the actual emission and velocity field: asymmetric bowl-local lobes, positive buoyancy, radial impulse and curl. Its domain is `[-1.7,-1,-1.7]` with size 3.4, leaving room above the bowl. The volume is not flipped. Moving bowl/lid boundary sampling remains shared.

Fighting simulation time equals reveal time. Its 211 frames cover 0–3.5 s at 60 Hz. Ice preserves its existing accelerated source-time mapping. Both profiles use density grids 128³/96³, velocity grids 64³/48³, depth clipping, occupancy skipping and existing render resolutions. Render-only Fighting colors and fades leave the Ice shader branch intact. Orange light is concentrated near the source; broader smoke uses burgundy shadows and red scattering.

The existing `ICEMIST3` encoding is retained, with a variant identifier in the manifest. Each variant validates its preset, timing, domain, solver/profile source hashes and Ball model hash. The loader downloads only the selected variant/device file; normal playback creates no solver. Invalid data falls back to that variant's live solver. Each replay retains at most two decoded CPU segments and two GPU atlas targets.

The host caches volumes lazily by variant and renders only the active volume. Its existing playback epoch cancels stale starts and preparation. Resize, visibility changes, pause, reverse seek and restart use the same host path. Disposal terminates every cached worker and releases all volume/effect resources. No second renderer, canvas or render loop is introduced.

## Commands and acceptance

- `pnpm dev` and `?reveal=fighting` — preview; `&smokeSource=live` explicitly selects authoring simulation.
- `pnpm smoke:export --variant=fighting --reference` — export both Fighting device profiles; preserve exact FP16 references outside the repo.
- `pnpm smoke:export --variant=ice --compare-ice=<baseline-directory>` — regenerate Ice metadata/data, asserting every original and quantized field matches the baseline before replacing either production asset.
- `pnpm test:fighting --motion` — geometry closure/volume, shared resources, fixed scale, gravity, rotation, deterministic rewind, rising density centroid, selected field CPU/GPU hashes, profile loading, lifecycle, invalid-file fallback, interrupted preparation, Full HD GPU timing, 28 stills and eight real-time recordings.
- `pnpm test:ice` — all 422 Ice CPU/GPU frames, replay/fallback and lifecycle regression.
- `pnpm test:ice --production` and `--production --mobile` — seven-type production form, correct device assets, no authoring solver or diagnostic GPU queries.
- `pnpm build` — TypeScript and Vite production build.

Visual acceptance covers 1.05 s (stage 03) and 2.4 s (stage 05), front/side cameras and both device profiles. Recordings at 1× and 0.2× are assessed separately from GPU measurements. The mobile viewport test is not a physical-phone benchmark.

Sataku preparation is recorded under its canonical `.3d-workflow/fighting-reveal`. Its campaign parity/source harness requires `src/scripts/3D.js` and `display.js`, which are absent in this standalone Vite app. App tests are not reported as a passed Sataku harness.

## Verification — 2026-11-08

- TypeScript/Vite production build passed after the final impact/spark revision. Vite retains its bundle-size advisory.
- `verify-fighting.mjs --motion` passed: both profiles, closed positive-volume geometry, rigid scale and rotation, gravity 4.3, deterministic rewind, eight selected CPU/GPU field comparisons, form selection, replay/fallback, interruption, resize, visibility and disposal. There were no JavaScript/WebGL shader errors.
- Saved 28 stills and eight canvas recordings in `C:/Users/Ewa-komp/AppData/Local/Temp/fighting-qa-1794132785372`. Both cameras and profiles were inspected, including stages 03 and 05. Recorded duration was 3497–3608 ms at 1× and 17492–17506 ms at 0.2×. Additional contact sheets sample the actual recorded video.
- Full-scene Full HD GPU: median **9.43 ms**, p95 **11.26 ms**, 209 samples, measured separately from recording on this machine. This meets the local 16.7 ms target; the narrow viewport does not represent physical-phone performance.
- Density centroid rose from **0.076 to 0.677** (desktop) and **0.065 to 0.633** (mobile) between 0.8 and 2.4 s. Smoke fields move upwards; the mesh is not flipped.
- Re-export compared all 422 original and 422 quantized Ice hashes with the pre-change files: identical. Fighting assets total **29,535,466 B**, loaded by selected device profile.
- Ice integration verified all **422 CPU/GPU frames**, reverse seeking, resizing, other effects, fallback and Full HD timing (p95 **10.85 ms**). Its final warmup-cancellation fixture initially injected invalid syntax into the new conditional warmup. The fixture now injects a block; the complete error/lifecycle subset passed on rerun, including disposal during warmup. Reports: `poke-ice-qa-1794132935349` and `poke-ice-qa-1794133096813` under the system temporary directory.
- Disposal leaves zero effect geometries and zero replay buffers. Instrumentation identified the two remaining renderer counters as Three.js r186's shared `DFG_LUT` and native transmission target; the test additionally verifies actual WebGL context loss. No application texture is left live.
- Production desktop and mobile checks passed for all seven types: exactly the requested device files, zero solver programs and zero diagnostic GPU queries. Fighting playback took 3566/3508 ms. Reports: `poke-ice-qa-1794133165567` and `poke-ice-qa-1794133210280`. Form tests use deterministic TCGdex fixtures, so they do not certify availability of the external API.
