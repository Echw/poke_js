# Ghost Reveal

Preview: `/?reveal=ghost`. Production search selects Ghost from the existing species/form data, including Gastly, Haunter and Gengar. Other species retain the existing first-supported-type routing.

Ghost reuses the **Fighting** desktop/mobile smoke clips, emitter simulation, deformation field, bowl transforms, depth capture, raymarch and intensity controls. No new smoke simulation, baked assets, renderer, light or animation loop is allocated. The Fighting solver, profiles, clips and their source checksums are unchanged. `GpuSmokeMist.sourceVariant` selects Fighting data while `GHOST_SMOKE` selects the violet appearance.

The full earlier Fighting smoke contribution is restored (`0.85`, replacing `0.34`). It uses the same simulation and baked clips with the darker Ghost palette. The later analytic smoke-strand imitation has been removed from `ghostVolume.ts`; density again comes from the irregular Fighting field and the two spirit condensations.

Actual light ribbons use the existing `makeRibbons` geometry: four open arcs on desktop and three on mobile, batched in one mesh. `ribbonMaterial.ts` shares Psychic's bright core and soft halo without changing its original output; `ghostRibbonMaterial.ts` adds Ghost's open S-bend vertex paths, slower flow and captured-depth clipping. These are additive light bands, independent of the smoke density.

Two local condensations share that volume. A smooth signed-distance union blends each rounded upper head into its bent, tapering lower body and smoke tail, removing the separate sphere/neck junction. Delayed waves follow the moving heads. Eyes use the same facial coordinates and dissolve with the bodies. The secondary spirit is smaller, higher, further back and weaker.

The smoke palette is color-managed from `#2B0B45` (deep violet), `#6E24A3` (midtones) and `#CF9CFF` (edge light). Head interiors stay darker while the tails receive moving light. The ribbon material retains Psychic's luminous core and violet halo. The existing point light supplies reflected violet light, with no new lights or bloom.

The existing `CardTransformation` owns the source, card outline and image handoff. Spirits fade between 1.38–1.98 seconds, before the image starts at 2.15 seconds. The card preserves its existing rotation, scale and scene ownership. Later fog clears the illustration corridor; the final frame retains a faint low residue and the shared card-edge glow.

The scene continues to own playback, interruption, reset, resize, reduced motion and disposal. Ghost renders its ribbon mesh once after fog, using the existing renderer and the existing Ball/card depth texture; no extra Scene, renderer or animation loop is created. The mesh is excluded from normal color and fog-depth passes. Ribbons grow from 0.20 to 0.80 seconds and fade between 2.15 and 2.85 seconds. Raymarch caching includes Ghost time. Empty-brick culling is disabled only for Ghost because its condensations can occupy empty simulation cells; hardware interpolation remains enabled. GPU resources are reused between repeated Ghost reveals and disposed by GhostEffect.

Validation: `npm run test:types`, `npm run test:ghost`, `npm run build`. The Ghost browser check records six phases on the regular starry background and a black-background reference on desktop/mobile. Enabled/disabled ribbon images must show a visible additive contribution while leaving the smoke field and card illustration unchanged. It checks actual mesh counts, depth texture binding, ribbon fade, violet density, smooth brightness changes, deterministic seeking, search, type switching, repeated playback memory, interruption, resize, reduced motion and disposal. Palette checks use unpremultiplied linear target pixels. Screenshots and motion recordings are written to the OS temporary `ghost-reveal-qa` folder. Psychic reference frames are captured before/after shared material extraction and compared separately.

The installed Sataku prepare workflow was used for helper discovery and scope tracking. Its final campaign verifier/source harness requires `src/scripts/3D.js` and a Sataku template, which this standalone Vite/Three.js application does not contain; use the actual application browser check above instead. No Sataku runtime was added to satisfy that unrelated gate.

The development preview artwork is Gastly, base1-50, from `https://assets.tcgdex.net/en/base/base1/50/high.webp`. Pokémon artwork and trademarks belong to their respective owners. Production search continues to use the selected TCGdex card.
