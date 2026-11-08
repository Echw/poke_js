Ice Reveal references [Glacial Crown](https://github.com/achrefelouafi/LinearAbiltyCastingThreeJS), particularly its GlacierAbility, GlacierMaterial, FrostFieldMaterial and ProceduralGeometry modules. The new implementation adapts the concepts of seeded faceted prisms, per-height freeze fronts, staged fracture and frost seams to the existing Pokémon reveal contract. It does not import the upstream engine, particle manager or editor.

The bounded volume follows the ray/box intersection, 3D noise sampling and front-to-back accumulation approach in the [official Three.js volume example](https://github.com/mrdoob/three.js/blob/dev/examples/webgl_volume_cloud.html). Scene-depth clipping, the hollow bowl mask and the world-down overflow field are specific to this project. The implementation targets the installed Three.js r186 WebGLRenderer.

MIT License

Copyright (c) 2026 mohamedachrefelouafi

Copyright (c) 2010-2026 three.js authors

Permission is hereby granted, free of charge, to any person obtaining a copy
of this software and associated documentation files (the "Software"), to deal
in the Software without restriction, including without limitation the rights
to use, copy, modify, merge, publish, distribute, sublicense, and/or sell
copies of the Software, and to permit persons to whom the Software is
furnished to do so, subject to the following conditions:

The above copyright notice and this permission notice shall be included in all
copies or substantial portions of the Software.

THE SOFTWARE IS PROVIDED "AS IS", WITHOUT WARRANTY OF ANY KIND, EXPRESS OR
IMPLIED, INCLUDING BUT NOT LIMITED TO THE WARRANTIES OF MERCHANTABILITY,
FITNESS FOR A PARTICULAR PURPOSE AND NONINFRINGEMENT. IN NO EVENT SHALL THE
AUTHORS OR COPYRIGHT HOLDERS BE LIABLE FOR ANY CLAIM, DAMAGES OR OTHER
LIABILITY, WHETHER IN AN ACTION OF CONTRACT, TORT OR OTHERWISE, ARISING FROM,
OUT OF OR IN CONNECTION WITH THE SOFTWARE OR THE USE OR OTHER DEALINGS IN THE
SOFTWARE.

The development-only card preview is the actual Glaceon card image, dp5-5, downloaded from https://assets.tcgdex.net/en/dp/dp5/5/high.webp. Pokémon card artwork and trademarks belong to their respective owners and are not covered by the software licenses above. Production search still loads the actual selected TCGdex card.

The Fighting development preview uses the actual Machop card, base1-52, downloaded from https://assets.tcgdex.net/en/base/base1/52/high.webp, under the same artwork ownership notice. It is a local preview fixture; production search loads the selected card.

The Poison development preview uses the actual Koffing card, base1-51, downloaded from https://assets.tcgdex.net/en/base/base1/51/high.webp, under the same artwork ownership notice. The local Poison species/form lookup was verified against https://pokeapi.co/api/v2/type/poison on 2026-11-08; no PokéAPI request is needed during playback.

The subsequent dry-ice revision uses the [SideFX Dry Ice example](https://www.sidefx.com/docs/houdini/shelf/spyro_dryice.html) as a behavioral reference for wall attachment and rolling overflow. No Houdini simulation, assets or source code are included.
