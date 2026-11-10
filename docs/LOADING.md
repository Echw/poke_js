# Startup preparation and caches

The HTML loader is visible before JavaScript. Search remains inert until `prepareAllReveals()` has prepared all 18 types. Each type is prepared once through a shared promise and a serial GPU queue. `play()` uses the same preparation barrier, then resets the existing effect and timeline. The device profile is fixed at scene creation (`innerWidth < 700`); resize only reframes/resizes rendering.

Preparation awaits effect textures and replay data, reuses fog depth compilation and `GpuSmokeMist.warmup()`, and renders representative states at 0, 1.4, 2.8 and 3.5 seconds behind the loader. After preparation, ordinary startup calls `scene.showIdle()` before hiding the loader: the ball is closed, card and effects are hidden, reveal lighting is off and the render loop is stopped. No default card is requested. A failed effect leaves the loader visible with Retry; successful preparation remains resident. Startup uses strict replay errors instead of silently replacing failed downloads with costly live simulation. Explicit development authoring still supports the live solver.

`showIdle()` retains warmed effects, replay data and card caches, resets the ball's pose/materials, and renders one static frame. Resize, visibility restoration and card texture loading respect idle state. Only a successful search with a loaded card image calls `play(type)` and starts the reveal; failed searches leave the closed ball unchanged. Later searches keep the existing behavior. Explicit development `?reveal=...` previews still load their fixture and autoplay; a failed preview card falls back to idle with a status message.

## Ownership and memory

- `SmokeClipStore` owns one worker and compressed clip per URL, with reference counting. Ghost and Fighting share their source. At most two clip initializations run concurrently.
- Decoded startup segments 0 and 1 are pinned per source. Only the active source retains its current/next rolling segments. No full-clip FP16 decode is retained. GPU render targets and material state remain owned by each effect.
- On desktop the four pinned startup pairs occupy 138,412,032 bytes; the active rolling pair may add 34,603,008 bytes, plus about 65.44 MB of compressed clips, transient worker buffers and GPU allocations. Full preload intentionally trades startup time and memory for immediate selection. Mobile uses the existing smaller profile (28.96 MB of compressed clips).
- The scene owns `CardTextureCache`: up to eight textures / 64 MiB (RGBA plus mip estimate), LRU eviction, current texture pinned, pending consumers leased. Requests temporarily in flight may exceed the retained budget. Oversized single images fall back through the existing low-quality image path.
- Successful normalized card queries use a 50-entry, 30-minute memory cache with in-flight deduplication. Errors and empty results are not cached. New cards still require external API/image access.
- `dispose()` terminates workers when their last consumer releases them, invalidates pending scene/image operations and disposes retained textures. A persisted pagehide keeps the scene for back/forward navigation; ordinary pagehide disposes it.

## Persistence

Production replay workers read `poke-replay-v1` CacheStorage. Vite content-hashed URLs identify versions. Header and all segment checksums are checked on disk reads and before writes; an invalid entry is deleted and fetched once. The existing preset/source/model contract checks remain enforced by the player. Development URLs bypass disk caching because they are mutable.

After preparation, prune only obsolete replay entries belonging to this application. Both current device profiles remain valid keys. Cache refusal, quota exhaustion or browser eviction falls back to network without blocking readiness. This is not an offline application: the document, API and uncached cards still need normal networking. GPU state is prepared anew in each page session.

## Validation

Run `node scripts/verify-loading.mjs` with Vite on 5173, and `node scripts/verify-loading.mjs --production` after building and starting preview on 5175. `LOADING_QA_URL` and `LOADING_QA_DIR` override the URL/output directory. Tests cover all types and both profiles, exact decoded source frames, restart reuse, shared files, resize, 50 searches, bounded card textures, disposal, retry, reduced motion and production cache corruption/denial/reload. Existing reveal tests remain the visual/motion regression reference.

Development snapshots expose preparation durations and cache counters through the existing debug handle. Performance entries `pokemon:api` and `pokemon:card-image` separate external request time from effect preparation. Timing comparisons must identify browser/GPU/cache conditions; do not interpret a local shader-cache run as a first-visit network benchmark.

## Lossless preload optimization

The container format is now **ICEMIST4**, with byte deltas modulo 256 between consecutive packed palette frames and gzip level 9. Each segment still contains at most four frames and starts with an absolute frame. The existing simulation contract remains `pokemon-ice-clip-v3`: palettes, FP16 density hashes, source hashes, source-frame indices, dimensions and timing are unchanged. ICEMIST3 XOR clips remain readable, including 8/12/16-bit data. Runtime decoding reconstructs four byte lanes at once and expands the palette in the same pass; this avoids a slower byte-by-byte restoration pass.

`scripts/transcode-smoke-clips.mjs <input-directory> <output-directory>` transcodes **existing** 8-bit clips rather than running the solver or quantizing again. It verifies original compressed/header hashes, packed-byte equality and every restored density hash before replacing each output file. The normal export builder also writes v4 for 8-bit exports; 12/16-bit exports retain v3. Run `node scripts/verify-smoke-codec.mjs [candidate-directory] [legacy-reference-directory]` to verify all frame hashes and legacy/wraparound fixtures.

| Selected profile | Previous files | Current files | Saved |
| --- | ---: | ---: | ---: |
| Desktop | 74,801,889 B | 65,436,328 B | 9,365,561 B (12.52%) |
| Mobile | 32,745,471 B | 28,955,783 B | 3,789,688 B (11.57%) |

Scene initialization now starts four compressed-source requests and the Ground/Rock/Steel image requests before GPU preparation. The existing store semaphore limits heavy replay downloads to two; prefetch does not decode every clip. Successful prefetch leases are released after all effects own their resources. Failed leases release automatically so retry can acquire a fresh source. Ground and Rock share two immutable texture objects, including the original color space, filtering, mipmaps, wrapping and anisotropy. Steel keeps its existing four-second fallback and uses a device-specific sampler lease. Last-owner release disposes each texture once, including late arrivals after disposal.

Warmup compiles drawable objects from the current effect, the original GLB mesh list and the active card manifestation. The GLB **root** is not a valid model-only scope because effects are subsequently attached below it; similarly, the card owns all eighteen manifestation roots. For each compile call, drawable children are excluded only during Three's synchronous material collection and restored in `finally` before yielding. No draw or transform occurs with that temporary scope. This avoids compiling inactive manifestations and counting root lights twice. The four existing real render states remain, plus targeted depth/geometry renders at 2.20 seconds to prepare the transient card-manifestation shader and its buffers. This handoff preparation does not decode another smoke segment or draw another volume; playback and warmup share the same depth-pass state helper. Fog depth, volume/composite preparation and transmission allocation remain intact. All eighteen effects still reach the barrier before `showIdle()`.

The Vite virtual module `virtual:smoke-source-hashes` computes normalized source hashes at build time and refreshes them when those files change in development. It replaces raw source-text imports without removing replay compatibility validation. Restart an already-running dev server when introducing `vite.config.ts`. GLB parsing and hashing use one fetched ArrayBuffer; only the hash remains cached. Development loads `smokeAuthoring` dynamically for live simulation/readback/export; the production bundle includes none of that module. Debug methods remain synchronous after `ready`.

Validation commands added for this change:

- `node scripts/verify-effect-textures.mjs`: ownership, shared requests, retry, late arrival and exact sampler configuration.
- `node scripts/verify-loading.mjs --motion`: the existing loading matrix plus full real-time playback of all eighteen effects on both profiles, checking shader count throughout playback and reporting observed buffering transitions.
- `node scripts/measure-loading.mjs` and `node scripts/measure-loading.mjs --production`: isolated cold-context/reload measurements for both profiles, five fog playbacks in development, one model request, one request per shared texture and a maximum of two heavy transfers. `LOADING_QA_URL` / `LOADING_QA_DIR` override the endpoint and report directory.
- `debug.snapshot().preparationGpuMs`: wall time around compilation and warmup rendering, excluding replay decode waits. This is CPU/driver preparation time, not a GPU timer-query result. `preparationMs` still includes the whole effect preparation; replay debug data separates transfer/validation, decode and upload.

Run `node scripts/verify-idle.mjs` (Vite 5173) and `node scripts/verify-idle.mjs --production` (preview 5175) for the closed-ball entry flow. It covers desktop/mobile, reduced motion, no startup card requests, failed and successful searches, delayed card images, resize/visibility, static rendering and reuse of prepared effects. `IDLE_QA_URL` / `IDLE_QA_DIR` override URL and output.

### Earlier preload/idle validation

- Closed-ball startup passed in development and production at 1280×800 and 600×800, with normal and reduced motion: zero startup card requests, static idle rendering, failed searches, delayed images, resize/visibility, original-look restoration and successful Normal/Fighting searches. Desktop/mobile idle and reveal screenshots were visually inspected.
- TypeScript and production Vite build passed (the existing large-bundle warning remains).
- Loading integration passed in development and production at 1280×800 and 600×800: all eighteen types, pinned restart data, no new shader programs on selection, exact sampled source frames, fifty searches per profile, resize, visibility pause/resume, superseded selection and cleanup.
- Production tests passed for four initial clip requests, zero on reload, one replacement request for a corrupted entry, obsolete-entry cleanup, unavailable storage, failed download/retry and reduced motion. Initial API failure leaves search usable.
- Existing Steel integration passed on both profiles, including its visual/material checks; type routing passed 154 cases and 36 deterministic motion paths. Additional startup resize/hidden-document inspection completed with eighteen ready effects and no page errors.
- Baseline local first-use preparation for Ghost/Ice/Ground/Poison was approximately 3–4 seconds; prepared selection in the local timing sample took 0.2–1.9 ms. These measure the effect start path, excluding card API/image time, and are not cross-device guarantees.
- Desktop before/after screenshots at 1.4 seconds were captured for all eighteen effects. Mean absolute RGB differences were below 0.0003/255; loader/error states and mobile effect frames were visually inspected. Physical mobile devices were not tested.
- The Sataku workflow inventory was prepared and OpenSpec validated. The canonical workflow's campaign readiness/verification gate does not support this standalone Vite project: it reports missing `3D.js` as canonical runtime divergence. The application has no Sataku runtime to synchronize, by design. The application's own Playwright fixture was used instead; no canonical harness pass is claimed.

### Lossless optimization validation (2026-11-10)

All 1,688 frames in eight new files match the originals' FP16 density SHA-256 values. The comparison checked 3,376 original/candidate frame hashes, unchanged palettes and timing metadata. Legacy 8/12/16-bit fixtures, modulo wraparound and shared-texture ownership/retry tests passed. The production main bundle decreased from 1,275.35 kB to 1,192.87 kB (gzip 348.64 to 327.93 kB); the existing large-chunk warning remains.

The final full-motion loading test passed for all eighteen effects at both widths: 151 shader programs after preparation versus 234 previously, no new programs during playback, and stable geometry/texture counts across fifty searches. Retained textures decreased from 73 to 71. Production loading/cache/retry and idle tests passed on the final build. Development idle, Steel, Rock and type-routing regressions also passed during this change. The development-only live solver, frame export/readback and return to replay were exercised successfully.

Thirty-six before/after effect images at 1.4 seconds were compared across both profiles. Maximum mean absolute RGB difference was 0.00055 on a 0-255 scale; decoded volume fields are bit-identical. Contact sheets were visually inspected. This samples appearance, not every rendered frame. Browser tests used Windows Chromium 151 and ANGLE/D3D11; the mobile profile is a 600 px viewport on the same machine, not a physical phone.

Final production startup samples, in seconds:

| Profile/cache | Baseline | Candidate |
| --- | ---: | ---: |
| Desktop, empty browser context | 24.57 | 34.92 |
| Desktop, reload | 3.45 | 6.88 |
| Mobile, empty browser context | 6.47 | 6.17 |
| Mobile, reload | 2.78 | 4.08 |

These single local samples **do not demonstrate end-to-end acceleration**. Earlier candidate iterations measured 23.25/3.37 seconds on desktop and 3.44/3.65 seconds on mobile, but they are not measurements of the final build. CPU/driver/cache conditions varied across runs; no causal explanation for the final slowdown has been established. An empty browser context is not proof of an empty GPU driver shader cache. Final development preparation CPU/driver wall times were 29.45/3.16 seconds (desktop cold/reload) and 3.99/1.75 seconds (mobile). Supplemental baseline reload phase timings were 2.06/1.91 seconds; its instrumented cold run had dependency reoptimization warnings and is excluded from comparison.

To separate codec cost from this variability, an alternating, warmed Node test decoded the same twenty representative segments per profile, with sixty measured samples per format. Gzip plus restoration median/p95 was 44.84/57.55 ms legacy versus 38.54/48.28 ms candidate on desktop, and 19.53/23.23 versus 16.24/21.77 ms on mobile. This supports reduced codec work in that isolated test, not a browser playback guarantee. Final browser decode medians were 42.1-44.6 ms desktop and 19.1-20.4 ms mobile; p95 reached 58.1/27.2 ms respectively.

The final isolated playback measurement observed fifteen desktop buffering transitions across ten fog playbacks and zero on mobile. Full-motion integration also observed desktop buffering. Baseline instrumentation did not count these transitions, so absence of **additional** stalls is unproven. The bounded current/next segment policy remains unchanged. Performance acceptance therefore remains open: repeat paired baseline/candidate browser measurements under controlled machine conditions and on target devices before claiming faster total startup or stall-free playback. Do not lower visual quality to close this gap.

Production cache checks confirmed four initial clip requests, zero on reload, and at most two concurrent heavy downloads. Model fetch/hash uses one request and shared images are requested once. Reports and image comparisons for this run are in `%TEMP%/poke-opt-baseline` and `%TEMP%/poke-opt-candidate` (local test artifacts, not shipped assets).
