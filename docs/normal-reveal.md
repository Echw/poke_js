# Normal Reveal

`NormalEffect` implements a quiet ivory reveal: one growing 1.5-turn light spiral,
one faint companion, fine offset filaments, sparse drifting points and four-ray
glints with independent birth/lifetime envelopes. Four glint events share the
exact birth times and path positions of the moving light packets.
The illustration clears as the spiral retracts and fades.

The approved spiral is preserved. Additional depth comes from two translucent
pearl-light fields based on Psychic's moving folds, an independent low sweep
based on Grass's orbit, and seeded motes that rise from the source on short curved
flights (42 mobile / 62 desktop events). These layers use the existing front/back
card passes. The aura clears early during materialization; the low sweep remains
only at the sides while the illustration appears. There are no leaves, crystals,
ground glows, added lights, textures or postprocessing passes.

Reused: `makeRibbons`, `CardTransformation` / `CardManifestation`, Fairy/Dragon's
disjoint card-space front/back passes, the scene's GSAP timeline, local fill light,
compact card pose, reset/finish and disposal contract. Fairy and Dragon effects
and their materials are unchanged. No renderer, animation loop, bloom, external
particle texture or per-spark light is added.
Grass and Psychic source files are unchanged; their shader concepts are adapted
inside the Normal material rather than instantiating another full effect.

New shaders in `normalMaterial.ts` provide white cores with soft shoulders and
broad faint halos, tapered ends, upward moving highlights and instanced particles.
The loose spiral varies its angular progression and radius. Five short curved
light wisps connect its source to the space above the bowl; they are light trails,
not smoke. All VFX stay at/above the bowl; no ground effect is created and the sky
background, exposure and global illumination remain unchanged. Absolute time and seeded
attributes keep seeking and replays deterministic. GPU resources are allocated
once per effect and reused. Normal-only Ball material clones reduce the original
white emission so the local PointLight can illuminate the bowl. The card silhouette
uses explicit source-distance attenuation because ShaderMaterial ignores scene
lights. The card image retains its existing unlit, color-accurate material.

Normal is selected from species identity (Eevee, Snorlax, Ditto); existing non-Normal
secondary types retain priority (Pidgeotto -> Flying, Jigglypuff -> Fairy).
Unknown Colorless cards use Normal only after the existing type fallbacks.
Development preview: `/?reveal=normal`, using the cached Jungle Eevee artwork
from TCGdex (`base2-51`). Final scale is 0.94; shared reveal timing ends at 3.5s.

Verification: `npm run build`, `npm run test:types`, and `npm run test:normal`
(requires the Vite server; `NORMAL_BASE_URL` overrides port 5173).
The browser test captures seven stages on desktop/mobile and checks visible shader
layers with minimum screen-area coverage, predominantly white light, moving packets
on a frozen path (separate flow clock), unchanged sky and no layer pixels below
the projected lower Ball boundary, rewind, reuse, search interruption,
resize, reduced motion and idempotent disposal. `NORMAL_QA_DIR` selects its artifacts.

Sataku workflow preparation was recorded. Its stock readiness/final gate assumes
`src/scripts/3D.js`, absent from this standalone Vite/Three application; its startup
harness likewise targets Sataku webpack templates. These checks cannot certify
this application. Direct application WebGL checks and visual inspection are used
instead, without installing a second runtime or changing the canonical agent.
