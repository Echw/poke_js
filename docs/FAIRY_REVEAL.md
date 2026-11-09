# Fairy Reveal

Development preview: `/?reveal=fairy`, using the local Sylveon fixture (`xy3-72`). Production search resolves the actual species/form through the existing ordered type catalog. Sylveon, Clefairy and Togekiss use Fairy; Gardevoir keeps Psychic, Mimikyu keeps Ghost, and Mawile keeps Steel. Unknown species can fall back to the TCG Fairy type.

Fairy reuses Dragon's actual stream vertex/fragment shaders through the optional Fairy field in `dragonMaterial`. This preserves the textured serpentine bodies, changing width, detached filaments, advected density, bright cores, traveling highlight heads/tails, and disjoint front/back card-space occlusion. Dragon's principal field, palette and flare table retain their original behavior; the later requested embellishments add shared orbit/dust layers and wider outward sparks to both types.

The two principal Dragon Bezier paths retain their full lateral span and ribbon widths from the start. Growth reveals them from the source; card materialization never expands their radius or width. Fairy's independent field applies gentle motion. Its pink/magenta/pearl palette, slower density flow, soft flare envelopes and local source-light response are selected only for Fairy. During the artwork handoff, upper tips shorten and central fragments fade without spreading the paths with the card.

New Fairy components:

- Six instanced petals with rounded outlines, asymmetric width, cupping and curl. Each has its own birth time, size, phase and tumble. Three drift left and three right, independently of the rotating energy, reaching past the main serpentines and Ball outline as they rise and fade. Surface normals are reconstructed from the deformed Ball-local positions. Distance attenuation, diffuse and transmitted source light brighten selected surfaces and edges while the shaded surfaces retain pink.
- Thirty-eight mobile / fifty-four desktop emitted sparks use Dragon's absolute-time origin sampling, drag and tapered bright-head trails. Their gentle arcs now spread beyond the Ball, with longer individual lifetimes. Four-armed traveling flares and small moving spark heads remain separate draws. Sixty-four mobile / ninety-six desktop dust events occupy a wider surrounding volume.
- Two Grass-inspired orbit bands add low sweeping arcs above the bowl and a higher counter-current, with thin companion filaments and moving pearl accents. Their full radius is independent of the card's scale and morph. The shared orbit/dust material is also used by Dragon.
- A procedural pink pool anchors the small pearl source. The scene's existing fill light creates localized pink bounce on the inner rim and upper bowl. Fairy-only material clones reduce the GLB's white emission so this light is visible. Other types restore the exact original material references; global exposure, environment intensity, key light, ambient light and background are unchanged for Fairy.

`CardTransformation` remains shared. Fairy adds only a palette/source branch and an airy pink silhouette with sparse filaments and dust. The existing 1.45 s morph, 2.15 s artwork handoff, 2.85 s fade and 3.5 s completion, card rotation, final 0.94 scale and scene playback ownership are preserved. The final card keeps a soft pearl-pink edge glow.

Geometry is shared between front/back passes. There are sixteen effect draws plus the shared transformation, no simulation, added renderer, animation loop or per-particle light. Per-frame work updates existing uniform values and cached matrices. Mobile reduces ribbon subdivisions and particle counts. Replays reuse resources; reset and seek are deterministic; switching hides the card-attached manifestation; disposal releases owned geometries, materials and instance buffers once.

## Verification

With Vite running, `npm run test:fairy` exercises desktop (1280×900) and mobile (390×844) WebGL rendering, seven timeline samples, every layer's pixel contribution, pink/pearl contrast, petal response to source lighting, nearby-frame motion, actual playback, rewind, three replays, search interruption and return, resize, reduced motion, exact material restoration and idempotent resource disposal. Reports and screenshots are written to `%TEMP%/fairy-reveal-qa` (`FAIRY_QA_DIR` overrides it). Rendering checks establish visible contributions; screenshot inspection assesses appearance and composition separately.

`npm run test:dragon` covers the shared shader's Dragon rendering, new embellishments and lifecycle. `npm run test:types` covers species/form routing. `npm run build` includes TypeScript checking. The existing GLB, background and production Sylveon artwork differ from the illustrated storyboard; the storyboard is a composition reference, not a runtime asset.

The Sataku inventory was prepared, but its campaign gate requires `src/scripts/3D.js`, and its source startup harness requires a Sataku webpack adapter. This standalone Vite project has neither. The gate reports a canonical runtime mismatch because the local runtime is absent; Vite/Playwright supplies this application's rendering evidence without installing another runtime.
