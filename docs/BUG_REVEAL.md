# Bug Reveal

Development preview: `/?reveal=bug`, using the local Caterpie base1-45 artwork.

## Composition and reuse

`BugEffect` implements the existing `PokemonRevealEffect` lifecycle. The scene owns its GSAP timeline and render loop. It lazily creates one Bug instance and reuses it on subsequent reveals.

- `makeRibbons` supplies the indexed ribbon geometry already used by Grass. The Bug shader adapts Psychic's inclined parametric orbits and Grass's organic width, taper, flowing highlights and core/halo treatment, without changing either existing effect.
- Four orbit bands on desktop, three on mobile. Staggered flare births permit at most two simultaneous traveling flares; their durations, flow speeds and widths differ. The bright core and soft halo are in the material, without bloom/postprocessing.
- Thirty-six fireflies on desktop, twenty-four on mobile. Not all are illuminated at once. They occupy a broad volume at independently seeded radii, heights and depths, with a gradual outward/upward drift. Analytic curves have continuously varying velocity, independent directions and light cycles. There are no shared lanes, waypoint slowdowns or clamped endpoints. Mobile spread is slightly reduced to keep the swarm in frame. Timeline sampling makes reverse seeks deterministic.
- Three paired insect membranes on desktop; two on mobile. Membranes have narrow paired lobes, luminous yellow-green edges and independently phased highlights on procedural veins. Geometry and material are shared within the instanced group. Chitin has been removed as requested.
- Decorations are **not displaced by the card**. Their trajectories depend only on time; materialization changes their opacity. This incorporates the requested revision after the initial plan.
- `CardTransformation` and `CardManifestation` own the lime/cream source, silhouette, image handoff and final subtle rim. Bug uses card scale `0.94`, position `(0, 0.37, 0.50)` and the existing rotation.
- A Bug-only depth mask shares the manifestation's actual orb-to-rounded-card distance field. It writes no color, follows the card, and is absent before materialization. Model depth and card depth occlude rear VFX; front VFX remain visible.

| Time | Behavior |
| --- | --- |
| 0–0.4 s | Source and first lights awaken. |
| 0.4–0.8 s | Orbit and illuminated membrane entrance; swarm spreads outward. |
| 0.8–1.45 s | Full insect aura with moving flares and independent swarm. |
| 1.45–2.15 s | Card silhouette forms; central ribbon brightness is reduced. |
| 2.15–2.85 s | Artwork appears; orbit and decoration opacity fades. |
| 2.85–3.5 s | Only the final three fireflies can remain; they fade out. |
| After 3.5 s | Artwork and subtle rim remain. |

Per-frame updates reuse vectors, matrices and typed arrays. No resources are allocated by the animation loop. Switching effects hides the card-attached manifestation/depth mask as well as the effect root. `stop()` retains the existing scene semantics (pause); restarting resets the state. Dispose frees owned materials, geometries and instance buffers, without disposing the shared card geometry or artwork.

## Ordered Pokémon types

`speciesRevealType` selects the first supported game type in slot order. If slot 1 has no effect, it tries slot 2. Unrecognized identities or identities with no supported type use the existing TCG/species fallback.

The catalog contains 1,351 base/form records generated from PokeAPI revision `6ea97b5641faa12e090866e8144ae8f57764fc64`, with `pokemon.csv`, `pokemon_species.csv`, `pokemon_types.csv` and `types.csv`. All inputs use the same revision; playback makes no PokeAPI requests. Regenerate with `npm run types:generate -- <revision>`; omitting the revision explicitly refreshes to upstream master. Windows environments with a corporate certificate can use `NODE_OPTIONS=--use-system-ca`.

Explicit regional/alternate qualifiers take precedence over the base form. Trainer prefixes and TCG suffixes are normalized. When Dex IDs are absent, English species names are recognized. Multiple-Dex cards use the first recognized ID in their supplied order. Unspecified forms use the base form; Paldean Tauros without a breed qualifier uses Combat Breed, and Galarian Darmanitan without a mode qualifier uses Standard Mode.

Examples: Caterpie/Butterfree → Bug; Skorupi → Poison; Snom → Ice; Pidgeotto → Flying; Lapras → Water; Geodude/Garchomp → Ground; Gengar → Poison (Ghost is not implemented); Hisuian Sneasel → Fighting. Psychic and Grass visuals are unchanged, though some species now correctly select a different reveal.

## Verification

- `npm run test:types`: ordered-type routing, alternate forms, names without Dex IDs, unknown-type fallback, multiple-Dex order, plus continuous and repeatable firefly trajectories.
- `npm run test:bug`: real WebGL desktop/mobile captures of six stages and final card from front/side; normal and quarter-speed recordings; search through the actual form; independent fly motion/pulses; rewind, restart, interrupted effect switching, resize, visibility pause, reduced motion, stable warmed GPU resource counts and disposal.
- Optional `BUG_BASELINE_DIR` enables comparisons with pre-change Psychic/Grass captures named `baseline-<type>-<time>.png` at 0.6, 1.25, 2.4 and 3.5 s. Startup status text above the scene is excluded; the comparison permits fewer than 0.05% scene pixels to differ by more than 2/255, with mean channel difference below 0.05/255. `BUG_QA_DIR` selects the evidence directory; default is the system temp directory's `bug-qa` folder.
- `npm run build` performs TypeScript checking and the Vite production build.

The Sataku `3d-change` inventory was prepared using local helper contracts. Its stock `check-ready`/`verify-batch` gate requires a canonical `src/scripts/3D.js`, which this standalone Three.js/Vite project does not host. That gate cannot certify this project; no runtime was installed and no agent tools were modified to bypass it. Project type checks, browser checks, visual inspection and semantic review are reported separately.

### Verified implementation

The routing check covers 94 cases and continuity/repeatability for all 36 firefly routes, checking nonzero continuous flight speed and broad spatial distribution on all three axes. Browser evidence is written to `bug-qa/report.json`, including frame counts, stable warmed GPU resource counts, disposal and eight Psychic/Grass comparisons. TypeScript and the Vite build are required after rendering changes; Vite retains its large-chunk advisory.

Visual review covers mobile framing, front/side depth, lit wing veins, outward swarm movement, card silhouette and artwork handoff, the final rim, and moving light with orbit geometry frozen. The only incomplete external gate is the stock Sataku verifier described above.
