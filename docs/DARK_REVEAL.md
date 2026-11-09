# Dark Reveal

Development preview: `/?reveal=dark`. Search selects Dark for the actual species/form from the existing ordered type catalog (for example Umbreon, Murkrow and Darkrai). Unknown species with TCG Darkness energy use the same fallback. A newly supported primary Dark type takes precedence over a secondary type, including Hisuian Qwilfish's Poison type.

## Reused resources

- Ghost's indexed `makeRibbons` geometry and asymmetric open S-bend construction. Four main streams and two narrower, softer secondary streams each have a smaller fork, batched in one geometry, with fewer segments on mobile.
- Ghost's exact advected fold/density and moving light-packet functions, extracted into `spectralFlowGLSL` in `ghostVolume.ts`. Ghost retains the same inputs and arithmetic, including its existing spirits; Dark includes only the matter/flow functions and has no faces or characters.
- Fighting's stateless birth/velocity/lifetime particle approach, adapted to 14 slow motes on desktop and 9 on mobile. No debris, gravity burst or orange palette is used.
- The existing scene point light, renderer, timeline and complete `CardTransformation` handoff. No new fog solver, clip, render target, animation loop or texture is required for the aura.

## Dark-specific rendering

`DarkEffect` owns its materials, shared strip geometry, motes and transformation. The shader operates in Ball-local space. Independently phased currents grow from `(0, -0.28, 0.50)` inside the bowl, with varying widths, depth offsets, delayed bends, soft forks and curling tapered tips. Advected noise and the Ghost folds create moving translucent gaps. Mobile narrows the spread without changing the card or camera.

The body uses normal alpha blending for absorbing black-wine matter. A second draw over the same geometry adds localized crimson folds and edges. Shared uniform objects update in place; vertices and motes move on the GPU. There are no frame-wise random values or allocations in `DarkEffect.update`.

Dark uses its own small burgundy source and shared card manifestation with a dark, irregular interior and thin crimson outline. It retains the common 1.45-second morph, 2.15-second image handoff, 3.5-second completion, rotation and `0.94` final card scale. The front smoke corridor opens before the illustration appears; residual side streams shorten and fade. Final card-edge glow remains.

Only Dark switches the Ball to cloned materials with reduced white emission and a less metallic bowl, allowing the existing source light to tint the rim red. Exposure, environment, camera and scene lighting settings are unchanged. Other reveals restore their original materials. Clones share the original texture references and dispose only their own material resources.

The scene continues to own activation, interruption, reset, playback, resize, reduced motion and disposal. A repeat reuses the same GPU resources. `finish()` zeros transient uniforms; disposal is idempotent. The existing post-reveal search/Summon interaction and shared card rotation are preserved; this application has no card-drag handler.

## Verification

Run the Vite server on port 5177, then `npm run test:dark` (or set `DARK_QA_URL`). Screenshots and the JSON report are written to `%TEMP%/dark-reveal-qa`.

The browser check covers desktop 1200×900 and mobile 390×844, all six stages, black and normal backgrounds, visible wine/crimson pixels, evolving structure, repeatable reverse seeking, an unobstructed illustration center in stage 05, final scale/rotation, actual continuous playback, stable geometry/texture counts across restarts, interruption/type switching, search/Summon, resize, reduced motion and disposal. Palette and visibility checks compare actual rendered framebuffer images. Visual review also checks depth, soft gaps, localized highlights, mobile tip framing and the stages 03/05 handoff.

Additional checks: `npm run test:types`, `npm run test:ghost`, `npm run test:fighting`, `npm run build`. The Sataku prepare workflow records scope and helper discovery. Its campaign verification/source harness requires a local `src/scripts/3D.js` and Sataku template, absent from this standalone application; actual-app browser tests provide rendering/lifecycle coverage instead. A Sataku verification pass is not claimed.

The local preview is the actual Umbreon card, neo2-13, downloaded from `https://assets.tcgdex.net/en/neo/neo2/13/high.webp`. Pokémon card artwork and trademarks belong to their respective owners; no software license is asserted for the artwork. The supplied storyboard guides the effect and is not used as a runtime texture. Production search loads the selected TCGdex card.
