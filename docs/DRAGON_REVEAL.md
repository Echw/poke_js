# Dragon Reveal

Development preview: `/?reveal=dragon`, with a local Dragonair fixture. Production selection follows the ordered species/form catalog: primary Dragon species use Dragon; secondary Dragon species retain their first supported type (Charizard uses Fire, Giratina uses Ghost).

The scene retains its single timeline, render loop, card rotation and fill light. `CardTransformation` retains the shared source → silhouette → artwork handoff at 1.45 / 2.15 / 2.85 / 3.5 seconds. Dragon ends at card scale 0.94 inside the Ball silhouette.

Reused elements:

- Grass/Flying's `makeRibbons` indexed strip attributes and shared geometry.
- Flying's view-ray intersection with the actual rounded, rotating card, split into disjoint behind/front passes.
- Bug's staggered traveling flare/head/tail approach, adapted to the same Dragon field as its billboard starbursts.
- Electric/Fighting's bright-head/fading-tail approach, with absolute-time drag trajectories for outward sparks.
- The shared source glow and card manifestation, with Dragon-only color and texture branches. The fluid smoke simulation is unnecessary for these sparse wisps.

The repaired material uses three independently shaped, depth-separated Bezier paths: a dominant blue S, a violet counter-current and a subdued rear current. Each has one broad textured body and two short, detached filaments instead of a bundle of parallel full-height wires. Advected noise modulates width and density. Card materialization does not shorten, spread or push back these paths; their normal flowing motion continues as they fade. Six timed flare events drive both traveling stream highlights and star sprites. Sixty-four desktop / forty-eight mobile spark events sample the current at birth and draw their tails along previous positions under exponential drag. Each emitted head also carries a small blue or violet starburst.

Fourteen desktop / nine mobile wisps sample procedural density at six depths through separate ellipsoids. These are lightweight translucent volume approximations, not a fluid simulation. A broken pool anchors the source inside the Ball; there is no ground glow beneath the Ball. The forming card carries blue/violet folds and sparse stars before the shared artwork handoff.

Dragon preserves the original starfield background. It dims the lid inserts, softens the bowl's fully metallic material and moves the existing fill light to illuminate the bowl. Two material clones share the original textures. Switching types restores the exact original material references and environment/light intensities; disposal releases the clones once without disposing shared textures.

The Fairy refinement also enriches Dragon with two Grass-inspired orbit bands: a low sweep above the bowl and a higher counter-current with moving bright accents. Fifty-six mobile / eighty-four desktop dust events occupy a wider volume, and the existing sparks have longer lifetimes and wider launches that carry them beyond the Ball. The original three principal serpentine paths, their timing and blue/violet palette are retained. Orbit radii are fixed independently of card materialization. The stream implementation is shared with Fairy through an optional field/palette branch; Fairy has its own path-motion and flare parameters.

There is no added renderer, animation loop, texture atlas, bloom pass or per-spark light. Geometry is shared between passes. Dragon uses sixteen transparent draws plus the existing transformation; per-frame updates mutate uniforms and cached matrices. Mobile uses fewer segments and events. Reset/seek are deterministic, finish hides the spell, switching disables the attached manifestation, and dispose releases each owned resource and instance buffer once.

## Validation

With Vite running, `npm run test:dragon` checks desktop/mobile WebGL output, captures six stages, checks the actual pixel contribution of streams/orbits/dust/wisps/flares/sparks/pool/stars and both colors, nearby-frame motion, deterministic rewind, repeated playback/resource reuse, search switching, preservation of the original starfield, exact restoration of the original Ball look, reduced motion and disposal. Evidence defaults to `%TEMP%/dragon-reveal-qa`; override with `DRAGON_QA_DIR`.

`npm run test:types` covers species/forms and routing regressions. `npm run build` includes TypeScript checking. Manual visual review compares stages 03 and 05 plus intermediate frames. Pixel contribution checks establish that layers render; they do not establish visual similarity. The storyboard guides the energy composition; it is not used as a runtime image or replacement Ball model. The existing GLB silhouette, button details and production card artwork still differ from the illustrated storyboard.

The Sataku workflow inventory was prepared. Its campaign readiness gate requires `src/scripts/3D.js`, and its startup harness requires a Sataku webpack adapter; neither exists in this standalone Vite app. The project's Vite/Playwright checks provide rendering evidence without installing a second runtime. The Sataku campaign gate cannot validate this application.
