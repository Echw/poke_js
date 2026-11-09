# Steel Reveal

Development preview: `pnpm dev --host 127.0.0.1 --port 5177`, then open
`http://127.0.0.1:5177/?reveal=steel`. The local Metagross image is the Metal card
me04-061. Production search continues to use the selected TCGdex artwork.

## Implementation

`SteelEffect` implements the existing `PokemonRevealEffect` lifecycle and uses the
scene's renderer, GSAP timeline, card rotation and final 0.94 card scale. No extra
render loop, per-particle lights or postprocessing are introduced.

- Grass/Dragon's `makeRibbons` supplies indexed open strips. Two complementary
  sweeps share a source: a broad, nearly horizontal orbit and a thinner rising
  return. Their different pitches and heights avoid stacked spring-like coils.
  The peak width is about 2.09 world units on desktop and 1.81 on mobile. CPU
  deformation updates the local twist and actual surface normals, so strips turn
  edge-on and their reflections move. The geometry contains no torus or closed ring.
- Water's source-born lateral fan and gravitational trajectories inform the
  basin jets, curled machining chips, twisted shavings and cut metal flakes. Fighting's `earthPosition`
  and `earthRotation` provide deterministic ballistic and rigid rotation helpers.
  Stone geometries/materials and water transmission are not reused.
- One opaque `MeshStandardMaterial` is shared by all metal. It uses real normals,
  metalness 1, a photographic brushed roughness/bump map and an owned studio
  reflection texture containing bright strips separated by dark graphite. The
  scene's night HDR remains intact. Ten short local glints accent selected bends
  and larger fragments.
- Two effect-owned, shadow-free directional lights add a cool left rim and softer
  white right accent. A silver-blue halo, irregular source radiance and soft outer
  haze fill the space around the vortex without triangular light-cone silhouettes.
  They grow from 0.20 seconds, peak with the orbit and
  fade completely by 2.85 seconds. These atmosphere planes share the projected
  card mask, respect the Ball's depth and use the existing animation clock.
- The central energy uses a hot narrow core with a soft sheath, a companion
  filament and three short source branches. An energized overlay shares the
  metallic basin-jet geometry. All emission shares the rotating-card mask and
  fades by 1.95 seconds; the corona fades with the existing atmosphere envelope.
- Eight larger folded cut shards (six on mobile) add scale above and outside the
  fine shavings. Their folds produce bright and graphite faces. Launch time and
  upward velocity use different seeds so fragments occupy different heights,
  while the existing gravity and rigid rotation keep seeking deterministic.
- `CardTransformation` owns the existing source-to-silhouette-to-image handoff.
  Steel adds a small cool source, silver silhouette and restrained card edge glow.
  The host's single fill light follows the basin. Steel reuses the existing subdued
  Ball material variant and restores the usual look when switching to another type.
- The Standard shader extension projects each fragment onto the actual rotating
  card plane before masking its footprint. This clears both the luminous silhouette
  and the illustration, including metal behind the transparent handoff. Front
  sweeps also retreat behind the card before shortening.

## Brushed texture

The user-supplied `reflective-brushed-metal-foil-texture-free.jpg` is processed into
`public/textures/steel-brushed-detail.webp` (1024 x 682). High-pass extraction removes
the photograph's broad light bands, retaining the fine horizontal grooves. One
linear-data texture drives roughness and a subtle 0.0011 bump scale; the existing
studio map and actual lights still produce the moving reflections. Ribbon and
basin-jet UVs follow the long sheet direction. The ejected shapes are open curled
and twisted sheets or thin, angular extrusions, with no spherical droplet geometry.

Regenerate with Pillow installed:

```powershell
python scripts/prepare-steel-texture.py "C:\Users\Ewa-komp\Downloads\reflective-brushed-metal-foil-texture-free.jpg"
```

The scene awaits `SteelEffect.ready` before playback and checks the existing
playback epoch afterward. Loading failure or a four-second timeout retains the
procedural roughness map. Late arrivals after timeout/disposal are released.
The loaded map is shared across every metal mesh and replay, and disposed once.
Activating another type disables both Steel lights; finished Steel keeps them at
zero intensity. `PokemonRevealEffect` is unchanged.

## Storyboard timing

| Stage | Time | Behavior |
| --- | --- | --- |
| Field growth | 0–0.45 s | Small source, growing first arc, sparse droplets |
| Attraction | 0.45–0.95 s | Open sweeps grow; lateral metallic fan develops |
| Steel orbit | 0.95–1.35 s | Full shared vortex and richest particle emission |
| Materialization | 1.45–2.15 s | Shared luminous card silhouette; metal clears its footprint |
| Emergence | 2.15–3.12 s | Actual image appears; sweeps shorten and debris falls |
| Final | 3.12–3.75 s | Main vortex disappears; three flakes settle in the basin |

Absolute-time deformation and seeded launches support backwards seeking,
interruption and replay. Reduced motion reaches the final pose through the host.
Disposal releases owned geometries, materials and textures once, while leaving
the scene's resources to their existing owner.

Steel is enabled in the ordered species/form type resolver. Primary Steel species
such as Metagross and Steelix select Steel; Scizor remains Bug and Empoleon remains
Water. Dialga now selects its primary Steel slot, which previously fell through to
Dragon because Steel was unsupported. Unknown cards with TCG Metal energy use the
Steel fallback.

## Verification

Run `pnpm test:steel` with the dev server on port 5177; override `STEEL_QA_URL` or
`STEEL_QA_DIR` if needed. The existing browser fixture obtains Playwright from the
installed agent. Screenshots of six stages and `report.json` go to
`%TEMP%/steel-reveal-qa` by default.

The browser check covers desktop/mobile and both backgrounds, real bright/dark
framebuffer samples on black, visible atmosphere contribution, zero metal or
atmosphere contribution inside the card silhouette/image, local normal
changes, deterministic seeking, peak emission, resource-stable replay, type
interruption, form search, live playback, resize, reduced motion and double disposal.
It also checks loaded roughness/bump readiness, delayed and failed texture loading,
disposal before texture arrival, non-spherical chips, light fading and deactivation.
Composition checks cover the wider open orbit, distributed larger shards and
the core/branch contribution in the real framebuffer. Metal, atmosphere and
energy are independently checked for zero contribution inside the card at handoff.
The composition revision changes only Steel VFX; the existing Ball model,
material selection, lights and camera remain as before this revision.
Screenshots require separate visual inspection for the vortex silhouette, depth,
metal quality, basin origin, framing and smooth card handoff.

Other checks: `pnpm test:types` and `pnpm build` (includes TypeScript checking).
The Sataku workflow preflight and preparation succeeded. Its final campaign
validator/source harness requires `src/scripts/3D.js` and the Sataku webpack
template, so it cannot validate this standalone Vite application. No runtime was
installed solely to satisfy that unrelated harness; the real app is tested instead.
