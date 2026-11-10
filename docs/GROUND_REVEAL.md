# Ground Reveal

Current loading, ICEMIST4 compression and resource ownership are documented in [LOADING.md](LOADING.md#lossless-preload-optimization). Historical file sizes and codec descriptions below predate the lossless transcode; density fields and the visual design are unchanged.

Ground uses the existing 3.5-second clock, camera, intact Ball model and card interaction. `?reveal=ground` selects the local Sandshrew base1-62 preview. Production selects primary Ground species/forms after Poison and Ice and before the TCG Fighting fallback. The local species table was verified against [PokéAPI Ground](https://pokeapi.co/api/v2/type/ground) on 2026-11-08; playback adds no lookup.

## Composition and sequence

Two tall rear rocks and two lower side rocks frame an open card corridor. A fifth low rock completes the right-hand group. Rocks lean outward and forward/backward by about 14–22 degrees, with varied yaw, tapered cross-sections and broken ledges. The card corridor remains open above the wider bases. No GroundPlate meshes or replacement soil disk exist. The clip plane at y=-0.11 is invisible and only hides submerged geometry.

Revision 4 replaces the six tiny side crumbs with a broken foreground arc: two larger boulders at the card's lower corners, two low center stones and two side links. Four sit ahead of the card plane; all remain below the illustration. They reuse the existing earth geometries, texture material and fog-depth pass. Their 0.42-unit sinking travel fully submerges the larger shapes before hiding them at 3.15 s, retaining the clean finale. This layout-only change does not alter smoke event data or require new replay assets.

Revision 5 moves that arc outward to the inner Ball rim, away from the card: boulder centers sit at radii 0.85–0.90, with the four front stones at z=0.71–0.87. Sizes, heights, sinking and the clean finale are unchanged.

Revision 6 animates the rim boulders from below the bowl instead of displaying them immediately. Their staggered emergence starts at 0.36–0.535 s, ends with slight settling by 1.015 s and holds during card materialization. Retreat begins at 2.35–2.49 s and ends at 2.97–3.11 s. Both directions use absolute-time translation through the same clip plane, with constant scale and opacity; reset hides the stones and reverse seeking recomputes their pose.

| Seconds | Behavior |
| --- | --- |
| 0–0.4 | Small amber source; foreground rocks start below the bowl. |
| 0.4–1.1 | Tall rocks and staggered foreground boulders emerge, decelerate and settle. |
| 1.1–2.15 | Full crown stays in place while the card silhouette materializes in the open middle. |
| 2.15–2.30 | Staggered retreat begins as the artwork appears. |
| 2.30–3.05 | Rocks sink below the opening, shedding small fragments and dust. |
| 3.05–3.5 | Last foreground boulders finish sinking by 3.11 s; the final bowl contains no earth meshes. |

Card pose is unchanged: scale 0.94, y=0.37, z=0.50. Ground retains its power3.out image fade during 2.15–2.85 s. Rock opacity and scale stay constant during retreat. Reduced-motion playback prepares Ground's final replay segment before jumping to the end.

## Shared mechanisms

- GroundEffect implements PokemonRevealEffect and uses Ice's clipped absolute-time translation pattern. Ice itself is unchanged.
- Ground retains five closed, non-convex soil geometries and one opaque rough nonmetallic material. No emissive seams or new ground surface are added.
- Fighting's six createEarthGeometry variants serve the temporary crumbs and 75 desktop / 45 mobile debris instances. Ground fragments are 0.032–0.072 units wide with stronger initial lift; EarthMotion supplies the same rigid ballistic calculation to both effects.
- GROUND_EVENTS derives breakthrough, settling and retreat releases from the actual pillar poses/times; both debris and the smoke solver consume that table.
- CardTransformation and CardManifestation provide the shared silhouette, image handoff and amber palette. The scene retains its sole renderer, timeline and cancellation epoch.

## Smoke correction

Ground reuses the existing MAC solver, moving bowl/lid boundary sampling, depth-aware volume renderer, occupancy skipping and bounded replay worker. Brown smoke is rendered directly from the simulated density field. The Ground-only sinusoidal groundWisps modulation, its time uniform and corresponding cache dependency were removed after an A/B comparison showed an artificial repeated pattern.

The render-only Ground opacity multiplier is 0.75, fading between 2.65 and 3.3 seconds. Shared simulation presets, grid resolution and interpolation are unchanged. Rocks, crumbs and the card contribute opaque depth; energy does not.

Only Ground desktop/mobile replay files need re-export for the revised event table. Ground manifests fingerprint groundEvents.ts. Ice/Fighting/Poison replay binaries are checked against their pre-correction SHA256 values, without re-export.

Normal playback loads only the selected device replay and creates no solver. Invalid data falls back to the existing Ground solver. Reset, reverse seeking, restart and disposal retain the existing host lifecycle. Geometry, materials and scratch transforms are reused; shared geometries are disposed once.

## User-provided rock textures (revision 3)

The supplied `Downloads/rocks_ground_02_4k.blend/textures` color, roughness and height maps are used on the rock material. The color is resized to 1024² WebP (quality 88); normalized height and roughness share the red/green channels of a lossless 1024² WebP. Both deployed files live in `public/textures/ground`, total 1,494,596 bytes. The original 4K files are untouched; the EXR normal map is not shipped. Height derivatives provide the surface relief.

Triplanar sampling prevents stretched caps and avoids requiring UVs on Fighting's shared fragment geometries. Color uses sRGB, packed surface data stays linear, and both maps use repeat/mipmaps with anisotropy 4. GroundEffect owns a single texture load; scene playback awaits it under the existing epoch guard. Material disposal releases both maps, including results arriving after teardown. There is no new renderer, frame loop or public effect-interface requirement.

Dust and fragment event positions follow the normalized inclined pillar axis and the actual retraction offset. Ground clips were re-exported for those events; smoke rendering and other variants' presets remain unchanged. The six foreground rocks use the revision 6 emergence/retreat described above and are hidden at finish; reverse seeking restores their corresponding pose.

## Checks

- `pnpm dev`, then `?reveal=ground`; append `&smokeSource=live` for authoring.
- `pnpm smoke:export --variant=ground` exports both Ground profiles.
- `pnpm test:ground --motion` checks the open center, rock inclination, absence of floor meshes, crown hold through 2.15 s, rigid late retreat, completely clear final bowl, textured-material readiness, visible fragment sizes, hulls, gravity, replay hashes and lifecycle (including delayed texture loading). It captures 36 stills and eight 1×/0.2× recordings across desktop/mobile and front/side cameras.
- `pnpm test:ice`, `pnpm test:fighting`, `pnpm test:poison` cover the shared renderer.
- `pnpm build` checks TypeScript and builds the production app.

Visual acceptance covers 1.2 s, 1.8–2.1 s, 2.4 s and the final state, plus enlarged smoke crops and recorded movement. Mobile viewport checks are not a physical-phone benchmark.

The canonical Sataku preparation/review lives under .3d-workflow/ground-reveal, with correction evidence in revision-2 and revision-3. Its campaign parity/source harness requires a local Sataku 3D.js host absent from this standalone Vite app. App harness results are reported separately and do not imply a passed Sataku campaign gate.

## Revision 2 verification (2026-11-08)

Historical results below describe the previous six-crumb ending, superseded by revision 3.

Automated Ground checks passed for both profiles, including the open corridor, no plates, full crown through 2.15 s, complete retreat by 3.05 s, six small side crumbs, reverse seeking, replay CPU/GPU hashes, restarts without resource growth, resize, visibility, reduced motion, switching, corrupt replay fallback, cancellation and disposal. No JavaScript or shader errors were recorded. The harness captured 36 stills and eight recordings; measured playback lasted 3.498–3.512 s at 1× and 17.489–17.536 s at 0.2×. Report: `C:/Users/Ewa-komp/AppData/Local/Temp/ground-qa-1794152978621/report.json`.

Visual review inspected desktop/mobile front/side stages 1.2, 1.8–2.1, 2.4 and 3.5 s, enlarged 2.7 s smoke crops, and sampled frames from all eight normal/slow recordings. Rocks frame the card without filling its corridor; the final bowl is exposed with small side crumbs. Smoke has soft edges without the removed periodic pattern. Motion samples show staggered rise and retreat with debris near the rocks; this is browser evidence, not a physical mobile-device performance test. Contact sheets and smoke crops are stored beside the report.

Only the Ground desktop/mobile replay binaries were replaced in this correction. SHA256 comparison confirmed the other six binaries are identical to the pre-correction baseline. TypeScript/Vite production build and `git diff --check` passed; Vite retains its bundle-size warning.

Shared-renderer regression reports: Ice passed at `C:/Users/Ewa-komp/AppData/Local/Temp/poke-ice-qa-1794153131086/results.json` (all 422 replay frames CPU/GPU exact); Fighting passed at `C:/Users/Ewa-komp/AppData/Local/Temp/fighting-qa-1794153253493/report.json`. Both recorded no JavaScript/shader errors.

Poison also passed at `C:/Users/Ewa-komp/AppData/Local/Temp/poison-qa-1794153320258/report.json`, with both profiles, lifecycle/fallback checks and no JavaScript/shader errors.

## Revision 3 verification (2026-11-08)

Automated: `verify-ground.mjs --motion` passed desktop/mobile with no JavaScript or shader errors. It verifies 14.2–21.9° actual rock tilt, an open card corridor, closed finite geometry, rigid retreat, larger debris sizes and gravity, a completely clean final bowl, deterministic reverse seek, device replay CPU/GPU hashes, stable resources across restarts, resize, visibility, reduced motion, search, fallback and disposal. Separate delayed-texture scenarios verified switching away and disposing while the two new images are still loading. Report: `C:/Users/Ewa-komp/AppData/Local/Temp/ground-qa-1794154211991/report.json`.

Visual: inspected front/side desktop/mobile stills, including full crown, materialization, fragment release and clean finish, plus sampled frames from all eight 1×/0.2× recordings. The rocks now angle outward, their caps and faces carry the supplied stone detail, chips are visible around the bases and retreating edges, and the card remains legible between the rocks. The 36 stills, eight recordings and contact sheets are beside the report. This is browser-based visual evidence, not a physical-phone benchmark or a claim of photographic equivalence to the concept image.

Both Ground clips were re-exported for the revised edge positions. All six Ice/Fighting/Poison binaries remain byte-identical to the revision-3 baseline. Production build (TypeScript + Vite) and diff whitespace checks passed; the existing Vite bundle-size warning remains.

The shared-host Ice integration regression also passed: `C:/Users/Ewa-komp/AppData/Local/Temp/poke-ice-qa-1794154356223/results.json`, including every desktop/mobile CPU/GPU frame, lifecycle/fallback scenarios and Full HD playback. Fighting and Poison suites were not repeated in revision 3: their source behavior and replay binaries are unchanged; their previous successful results are recorded above. Sataku campaign verification remains unavailable at the local 3D.js parity gate.

## Revision 4 verification (2026-11-08)

Ground tests and production build passed. The added bounds checks confirm four boulders ahead of the card, low central stones and sufficient sinking distance for complete clipping. Existing reset, reverse-seek, memory, replay, texture cancellation and disposal checks also passed without JavaScript/shader errors. Report and 36 stills: `C:/Users/Ewa-komp/AppData/Local/Temp/ground-qa-1794154803250/report.json`.

Visual review checked desktop/mobile front and side views at card materialization/reveal, plus the sinking and clean final states. Foreground boulders fill the empty lower arc while the card illustration stays unobstructed. No new motion recordings or unrelated effect suites were run for this layout correction. Smoke data, textures and other effect implementations are unchanged.

Revision 5 placement checks, full Ground tests and build passed. Reviewed front/side desktop and mobile frames: stones now follow the inner rim with more space around the card. Report and 36 stills: `C:/Users/Ewa-komp/AppData/Local/Temp/ground-qa-1794155201058/report.json`. No replay, texture, animation-timing or resource-ownership changes were needed; the Sataku campaign parity limitation remains unchanged.

Revision 6 Ground tests with `--motion` and build passed. New checks cover hidden starting positions, staggered intermediate emergence, full-height hold, fixed-scale sinking, complete hiding and deterministic reverse seeking of the foreground rocks. Existing lifecycle and texture-cancellation checks also passed with no shader/JavaScript errors. Report, 36 stills and eight recordings: `C:/Users/Ewa-komp/AppData/Local/Temp/ground-qa-1794155393682/report.json`. Sampled all normal/slow front/side desktop/mobile recordings at 0.3, 0.65, 1.1, 2.7 and 3.15 s: the rim starts empty, rocks emerge progressively and withdraw fully. Replay assets and shared smoke logic are unchanged.
