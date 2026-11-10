# Poison Reveal

Current loading, ICEMIST4 compression and resource ownership are documented in [LOADING.md](LOADING.md#lossless-preload-optimization). Historical file sizes and codec descriptions below predate the lossless transcode; density fields and the visual design are unchanged.

Poison uses the existing 3.5-second reveal, Ball model, camera, card interaction and `CardTransformation`. `?reveal=poison` selects the local Koffing base1-51 preview in development. Production selects Poison only when it is the primary type of the species/form, independently of TCG energy. The local table uses `slot === 1` from PokéAPI's Poison endpoint, verified on 2026-11-08; no runtime PokéAPI fetch is introduced. Secondary Poison follows the pre-existing resolver: Bulbasaur, Ivysaur and Venusaur retain Grass, while Koffing retains Poison. Regional forms and name aliases follow the same primary-type rule; other routing rules are unchanged.

## Reuse and ownership

- `liquidSurface` extracts Water's exact radial pool geometry, world-space environment sampling and card-space opacity mask. Water's timing, waves, materials and stream remain unchanged.
- `PoisonEffect` implements the existing effect lifecycle. The scene owns the single renderer/timeline and caches its volume lazily, using the same playback epoch cancellation and depth capture as Ice/Fighting.
- `CardTransformation` and `CardManifestation` supply the source, card silhouette, artwork handoff and final border. Poison adds a restrained purple palette; final card scale is 0.94 at y=0.37, z=0.50.
- Smoke reuses the MAC solver, bowl/lid boundaries, bounded replay worker, occupancy acceleration and depth-aware volume renderer. Poison has independent emission, positive buoyancy, colors and fades. It does not reuse Fighting's shock impulses or Ice's downward motion.

## Procedural boiling

The surface is anchored at y=-0.14 with the Water disk's z=0.05 offset. Sixteen deterministic events (eleven on mobile) have different positions, sizes and birth/pop times. The surface begins bulging 0.06 seconds before its membrane appears. Absolute-time poses make pause, reverse seek and restart independent of frame rate. Real surface vertices form local bulges, depressions and short damped disturbances; there are no persistent global rings.

Each event joins a growing submerged dome, thin membrane, rupture, low liquid crown and released drops. Dome diameters range from 0.16 to 0.52 local units against a roughly 2-unit bowl. At most eight desktop/five mobile bubbles and 48/28 drops can render; the same geometries/materials and preallocated transform scratch objects are reused. Six/four drops are available per event. Event-uniform capacity is shared by CPU and GLSL. No vectors, materials, geometry or pose objects are allocated by the per-frame effect update.

The membrane uses a transparent plum center, brighter Fresnel edges and two compact highlights. Its lower portion clips against the same surface-height formula as the pool. A warped angular opening grows from a top/front-biased point over 0.18 seconds; the wet boundary remains rounded and the sphere does not shrink to simulate rupture. The translucent surface crown lasts 0.26 seconds and has a bright wet lip. Drops sample its top edge at their individual release times, beginning 0.045 seconds after rupture starts, and use acceleration -3.4 in local Y. They disappear on re-entry into the liquid or just below the bowl lip; distant droplets fade between |x|=1.45 and 1.80 to stay inside mobile framing.

Detached gas bubbles rise and curve left/right by 0.90 local units, reaching approximately |x|=1.3–1.5 at rupture. Lateral drift starts only after full growth; motion continues through rupture. Airborne drops start on the current membrane surface and inherit its analytic XYZ velocity. Their upward release kick is smaller than that of liquid splashes. Neither a separate ground crown nor a static birth position is used for airborne ruptures. Normal transforms account for nonuniform instance scale.

## Timing

| Time | Behavior |
| --- | --- |
| 0–0.55 | Small source, first local bulges and smoke. |
| 0.55–1.0 | Growing domes, early tears and droplets. |
| 1.0–1.45 | Staggered peak boiling and ruptures. |
| 1.45–2.15 | Shared card silhouette; remaining events move to the sides. |
| 2.15–2.85 | Artwork appears; emissions end and existing smoke disperses. |
| 2.85–3.5 | Last small side bubble, fading surface and smoke. |

The source and simulation remain bowl-local. Render-only advected volume detail adds translucent pockets to Poison without changing the saved density fields. Thin membranes, energy and liquid do not become opaque fog occluders. The card uses the existing fog-depth handoff, while liquid masks follow artwork opacity.

Poison emission is concentrated near x=-0.62/+0.59 inside the bowl. Counter-rotating air rolls carry the two plumes outward above the rim, then upward at the sides, with a weaker rear source and minimal central emission. Upper wisps dissipate smoothly above y=0.75–1.50 before reaching the UI or volume edge. Emission ends at 2.1 seconds; the existing render fade clears the final card by 3.5 seconds. All new flow/dissipation branches are gated by `POISON_SMOKE`; Ice/Fighting physics are unchanged.

## Replay compatibility

Poison has separate desktop/mobile assets with 211 frames. Only the active device/variant is downloaded. Invalid data falls back to the same variant's live solver. Existing two-segment CPU/two-target GPU bounds and cleanup remain in place.

The replay contract hashes shared simulation/profile source files. Adding a variant invalidates old metadata even if its old shader branches are unchanged. Before editing, the four Ice/Fighting clips were copied to the canonical agent's ignored `.3d-workflow/poison-reveal/baseline`. Export supports `--compare-ice=<directory>` and `--compare-fighting=<directory>`: every original FP16 and quantized density hash must match the baseline before either device asset is replaced. Hash validation is never bypassed.

The codec now stamps per-frame source indices from the selected variant's manifest rather than always using Ice's accelerated clock. Already exported Fighting/Poison headers were corrected accordingly with new header checksums; compressed density payloads were unchanged and independently checked. Future exports write the correct metadata directly.

## Verification commands

- `pnpm test:poison --events`: species/forms, submerged dome growth, tear progression, outward gas trajectories, inherited drop velocity, gravity and pool capacity over the complete timeline.
- `pnpm smoke:export --variant=poison --reference`: generate both Poison device clips with FP16 references outside the repository.
- `pnpm test:poison --motion`: replay CPU/GPU checks, 52 stills, eight front/side recordings at 1× and 0.2×, rewind, all effect switches, form submission, resize, visibility, interruption, invalid replay fallback, disposal and Full HD GPU timing.
- `pnpm test:ice`, `pnpm test:fighting`: existing regression suites.
- `pnpm test:ice --production` and `--production --mobile`: eight-type production search including separate Grass and Poison species, selected-device replay requests, zero solver programs and no diagnostic GPU queries.
- `pnpm exec tsc --noEmit` and `pnpm build`: static typing and production bundle.

The Sataku `3d-change` helper lookup and preparation were performed. Its campaign readiness/parity check rejects this standalone Vite application because `src/scripts/3D.js` is absent. App browser tests are the applicable preview; they are not claimed as a passed Sataku source harness. No Sataku runtime or agent-tool change is introduced.

## Initial implementation results — 2026-11-08

- `pnpm exec tsc --noEmit` and `pnpm build` passed. Vite retains its bundle-size advisory; the main bundle is about 1.02 MB before gzip.
- `pnpm test:poison --motion` passed on both profiles: event/species contracts, eight selected CPU/GPU field comparisons, reverse seek, switching all eight effects, form submission, resize, visibility, interrupted preparation, invalid replay fallback and idempotent disposal. No JavaScript or WebGL shader errors were reported. Disposal leaves zero effect geometries and zero replay buffers.
- Full-scene Full HD GPU: **8.75 ms median, 10.09 ms p95**, 210 samples on the local RTX 3050 laptop GPU, measured separately from recording. This meets the local 16.7 ms target; viewport emulation is not a physical-phone benchmark.
- Inspected 44 Poison stills, Water regression stills and decoded contact sheets from eight recordings covering both cameras/profiles at 1× and 0.2×. The required progression is visible: submerged growth, an expanding hole, remaining wet film, nearby liquid release, ascending gas versus falling drops, and a cleared card illustration. One desktop 1× recording was repeated in isolation after a concurrent build affected the first recording. Final recordings lasted 3495–3604 ms at 1× and 17490–17511 ms at 0.2×.
- Poison assets total **14,185,157 bytes**. Both existing Ice and Fighting profiles retained every original/quantized field hash on re-export. A final byte comparison also confirmed all four compressed payloads are identical to the pre-change baseline; only metadata changed.
- `pnpm test:ice` and `pnpm test:fighting` passed, including 422 Ice CPU/GPU frame checks and their lifecycle/fallback scenarios. Ice GPU p95 was 11.25 ms; Fighting p95 was 13.08 ms.
- Production desktop/mobile tests passed for all eight types. Poison playback took 3507/3511 ms; only the matching device clip was requested, with no solver programs or diagnostic GPU queries. API responses in these tests are deterministic fixtures, not an external service availability check.

Evidence directories under `C:/Users/Ewa-komp/AppData/Local/Temp/`:

- `poison-qa-1794135913376`: report, stills, recordings and decoded frame sheets.
- `poke-ice-qa-1794136072038`: Ice regression report.
- `fighting-qa-1794136159602`: Fighting regression report.
- `poke-ice-qa-1794136255413` and `poke-ice-qa-1794136289477`: production desktop/mobile reports.

Canonical workflow records, the baseline and final asset audit remain under the agent's ignored `.3d-workflow/poison-reveal/`. The unsupported Sataku parity/source-harness gate is recorded separately from the successful application checks.

## Wider Poison revision — 2026-11-08

- Reused the existing event poses, instanced meshes, liquid surface, card handoff and smoke solver. No new renderer, RAF, dependency or routing change was introduced.
- Sixteen/eleven desktop/mobile events reach a maximum of eight/five live bubbles and 31/13 live drops when sampled at 120 Hz, within the allocated 8/5 and 48/28 limits.
- At 1.6 s, the exported above-bowl density spans 2.71/2.69 local units (desktop/mobile), compared with 1.49/1.66 before this revision. At 2.0 s it spans 3.13/3.08 units, approximately 1.5 bowl widths. These measurements use density >0.025 in world Y=0–1.5; they describe the density field rather than a screen-space opacity threshold. Both plumes dissipate before the ±1.7 volume boundary.
- Poison replay sizes are 15,585,401 bytes desktop and 7,146,903 bytes mobile (22,732,304 total); only the selected device file is downloaded. Denser/wider motion increases download size relative to the initial effect.
- Baseline clips for this revision are preserved under `.3d-workflow/poison-spread/baseline`. Before/after screenshots, acceptance inventory and field-width measurements are in `C:/Users/Ewa-komp/AppData/Local/Temp/poison-spread-1794146785564`.
- Sataku preparation succeeded; its readiness gate again reports missing canonical-runtime parity for this standalone Vite app. The local Vite preview is assessed separately.
- `pnpm test:poison --motion` passed: both device profiles, 52 captured stage/rupture stills, eight recordings, CPU/GPU replay samples, backwards seek, all eight effect switches, resize, hidden-tab pause, invalid-replay fallback, interrupted preparation and double dispose. No shader or JavaScript errors were reported; disposed effect geometry/replay buffers return to zero.
- Full HD GPU timing, measured after recording in a separate context: 210 samples, median **7.24 ms**, p95 **14.99 ms** (target <16.7 ms). This is the local GPU result; mobile checks use a mobile viewport, not a physical phone.
- Recorded 1× playback lasted 3495–3505 ms; 0.2× playback lasted 17486–17513 ms. Reports and recordings are in `C:/Users/Ewa-komp/AppData/Local/Temp/poison-qa-1794148160150`.
- Ice and Fighting exports both matched all 211 original and 211 quantized fields for both devices. A separate byte comparison confirmed identical compressed payloads in all four clips; only compatibility metadata changed.
- `pnpm exec tsc --noEmit` and `pnpm build` passed. The existing Vite bundle-size advisory remains; the main bundle is approximately 1.02 MB before gzip.
- Reviewed the before/after images, exact-time stage and rupture screenshots, Water regression images, and decoded frame sequences from all eight normal/slow recordings. Side views retain contact with the liquid; the detached membranes fan out above the rim; central artwork remains clear. `visual-review.json` and `*.webm.frames.png` in the Poison QA directory record the video review. Video seeks show the nearest captured frame; exact phase checks use deterministic screenshots.
- Fresh Ice and Fighting regression suites passed with zero reported errors. Production desktop/mobile checks passed for all eight effects, including Grass Bulbasaur and Poison Koffing; only the selected device replay is loaded, with no authoring solver or diagnostic GPU queries. Poison production playback measured 3465/3495 ms desktop/mobile.
- Regression reports: `poke-ice-qa-1794148347352/results.json`, `fighting-qa-1794148415444/report.json`; production reports: `poke-ice-qa-1794148456869/results.json` and `poke-ice-qa-1794148483843/results.json`, all under the local temporary directory.
