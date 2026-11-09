The Dragon development preview uses the actual Dragonair card, base1-18, downloaded from https://assets.tcgdex.net/en/base/base1/18/high.webp, under the same Pokémon artwork ownership notice below. Its energy, halos, flares, pool and sparks are procedural; the supplied storyboard is a visual reference, not a runtime texture.

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

The Flying development preview uses the actual Pidgeotto card, base1-22, downloaded from https://assets.tcgdex.net/en/base/base1/22/high.webp, under the same artwork ownership notice. Flying species/forms were verified against https://pokeapi.co/api/v2/type/flying on 2026-11-08. The wind, highlights and feather texture are procedural; the supplied storyboard is a visual reference, not a runtime texture.

The Poison development preview uses the actual Koffing card, base1-51, downloaded from https://assets.tcgdex.net/en/base/base1/51/high.webp, under the same artwork ownership notice. The local Poison species/form lookup was verified against https://pokeapi.co/api/v2/type/poison on 2026-11-08; no PokéAPI request is needed during playback.

The subsequent dry-ice revision uses the [SideFX Dry Ice example](https://www.sidefx.com/docs/houdini/shelf/spyro_dryice.html) as a behavioral reference for wall attachment and rolling overflow. No Houdini simulation, assets or source code are included.

The Ground development preview uses the actual Sandshrew card, base1-62, downloaded from https://assets.tcgdex.net/en/base/base1/62/high.webp, under the same artwork ownership notice. Primary Ground species and forms were verified against https://pokeapi.co/api/v2/type/ground on 2026-11-08. Ground geometry is procedural; the supplied storyboard is a visual reference, not a runtime texture.

Ground revision 3 uses color, roughness and height textures supplied by the user from `Downloads/rocks_ground_02_4k.blend/textures`. Browser derivatives are `public/textures/ground/rock-color.webp` and `rock-surface.webp` (height/roughness packed into red/green). The local folder did not include a license notice; no software license above is asserted for these user-provided images. Original files are unchanged.

The Bug development preview uses the actual Caterpie card, base1-45, downloaded from https://assets.tcgdex.net/en/base/base1/45/high.webp, under the same artwork ownership notice. Its ribbons, membranes, veins and firefly glow are procedural; the supplied storyboard is not used as a runtime texture.

The ordered species/form type catalog is derived from [PokeAPI data revision 6ea97b5641faa12e090866e8144ae8f57764fc64](https://github.com/PokeAPI/pokeapi/tree/6ea97b5641faa12e090866e8144ae8f57764fc64/data/v2/csv). The upstream BSD-3-Clause notice follows:

Copyright (c) © 2013–2023 Paul Hallett and PokéAPI contributors (https://github.com/PokeAPI/pokeapi#contributing). Pokémon and Pokémon character names are trademarks of Nintendo.

All rights reserved.

Redistribution and use in source and binary forms, with or without modification, are permitted provided that the following conditions are met:

* Redistributions of source code must retain the above copyright notice, this list of conditions and the following disclaimer.
* Redistributions in binary form must reproduce the above copyright notice, this list of conditions and the following disclaimer in the documentation and/or other materials provided with the distribution.
* Neither the name of PokéAPI nor the names of its contributors may be used to endorse or promote products derived from this software without specific prior written permission.

THIS SOFTWARE IS PROVIDED BY THE COPYRIGHT HOLDERS AND CONTRIBUTORS "AS IS" AND ANY EXPRESS OR IMPLIED WARRANTIES, INCLUDING, BUT NOT LIMITED TO, THE IMPLIED WARRANTIES OF MERCHANTABILITY AND FITNESS FOR A PARTICULAR PURPOSE ARE DISCLAIMED. IN NO EVENT SHALL THE COPYRIGHT HOLDER OR CONTRIBUTORS BE LIABLE FOR ANY DIRECT, INDIRECT, INCIDENTAL, SPECIAL, EXEMPLARY, OR CONSEQUENTIAL DAMAGES (INCLUDING, BUT NOT LIMITED TO, PROCUREMENT OF SUBSTITUTE GOODS OR SERVICES; LOSS OF USE, DATA, OR PROFITS; OR BUSINESS INTERRUPTION) HOWEVER CAUSED AND ON ANY THEORY OF LIABILITY, WHETHER IN CONTRACT, STRICT LIABILITY, OR TORT (INCLUDING NEGLIGENCE OR OTHERWISE) ARISING IN ANY WAY OUT OF THE USE OF THIS SOFTWARE, EVEN IF ADVISED OF THE POSSIBILITY OF SUCH DAMAGE.
