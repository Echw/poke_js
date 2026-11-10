# Startup preparation and caches

The HTML loader is visible before JavaScript. Search remains inert until `prepareAllReveals()` has prepared all 18 types. Each type is prepared once through a shared promise and a serial GPU queue. `play()` uses the same preparation barrier, then resets the existing effect and timeline. The device profile is fixed at scene creation (`innerWidth < 700`); resize only reframes/resizes rendering.

Preparation awaits effect textures and replay data, reuses fog depth compilation and `GpuSmokeMist.warmup()`, and renders representative states at 0, 1.4, 2.8 and 3.5 seconds behind the loader. Initial card lookup runs concurrently. A failed initial card does not block search. A failed effect leaves the loader visible with Retry; successful preparation remains resident. Startup uses strict replay errors instead of silently replacing failed downloads with costly live simulation. Explicit development authoring still supports the live solver.

## Ownership and memory

- `SmokeClipStore` owns one worker and compressed clip per URL, with reference counting. Ghost and Fighting share their source. At most two clip initializations run concurrently.
- Decoded startup segments 0 and 1 are pinned per source. Only the active source retains its current/next rolling segments. No full-clip FP16 decode is retained. GPU render targets and material state remain owned by each effect.
- On desktop the four pinned startup pairs occupy 138,412,032 bytes; the active rolling pair may add 34,603,008 bytes, plus about 75 MB of compressed clips, transient worker buffers and GPU allocations. Full preload intentionally trades startup time and memory for immediate selection. Mobile uses the existing smaller profile.
- The scene owns `CardTextureCache`: up to eight textures / 64 MiB (RGBA plus mip estimate), LRU eviction, current texture pinned, pending consumers leased. Requests temporarily in flight may exceed the retained budget. Oversized single images fall back through the existing low-quality image path.
- Successful normalized card queries use a 50-entry, 30-minute memory cache with in-flight deduplication. Errors and empty results are not cached. New cards still require external API/image access.
- `dispose()` terminates workers when their last consumer releases them, invalidates pending scene/image operations and disposes retained textures. A persisted pagehide keeps the scene for back/forward navigation; ordinary pagehide disposes it.

## Persistence

Production replay workers read `poke-replay-v1` CacheStorage. Vite content-hashed URLs identify versions. Header and all segment checksums are checked on disk reads and before writes; an invalid entry is deleted and fetched once. The existing preset/source/model contract checks remain enforced by the player. Development URLs bypass disk caching because they are mutable.

After preparation, prune only obsolete replay entries belonging to this application. Both current device profiles remain valid keys. Cache refusal, quota exhaustion or browser eviction falls back to network without blocking readiness. This is not an offline application: the document, API and uncached cards still need normal networking. GPU state is prepared anew in each page session.

## Validation

Run `node scripts/verify-loading.mjs` with Vite on 5173, and `node scripts/verify-loading.mjs --production` after building and starting preview on 5175. `LOADING_QA_URL` and `LOADING_QA_DIR` override the URL/output directory. Tests cover all types and both profiles, exact decoded source frames, restart reuse, shared files, resize, 50 searches, bounded card textures, disposal, retry, reduced motion and production cache corruption/denial/reload. Existing reveal tests remain the visual/motion regression reference.

Development snapshots expose preparation durations and cache counters through the existing debug handle. Performance entries `pokemon:api` and `pokemon:card-image` separate external request time from effect preparation. Timing comparisons must identify browser/GPU/cache conditions; do not interpret a local shader-cache run as a first-visit network benchmark.

### Verified in this change

- TypeScript and production Vite build passed (the existing large-bundle warning remains).
- Loading integration passed in development and production at 1280×800 and 600×800: all eighteen types, pinned restart data, no new shader programs on selection, exact sampled source frames, fifty searches per profile, resize, visibility pause/resume, superseded selection and cleanup.
- Production tests passed for four initial clip requests, zero on reload, one replacement request for a corrupted entry, obsolete-entry cleanup, unavailable storage, failed download/retry and reduced motion. Initial API failure leaves search usable.
- Existing Steel integration passed on both profiles, including its visual/material checks; type routing passed 154 cases and 36 deterministic motion paths. Additional startup resize/hidden-document inspection completed with eighteen ready effects and no page errors.
- Baseline local first-use preparation for Ghost/Ice/Ground/Poison was approximately 3–4 seconds; prepared selection in the local timing sample took 0.2–1.9 ms. These measure the effect start path, excluding card API/image time, and are not cross-device guarantees.
- Desktop before/after screenshots at 1.4 seconds were captured for all eighteen effects. Mean absolute RGB differences were below 0.0003/255; loader/error states and mobile effect frames were visually inspected. Physical mobile devices were not tested.
- The Sataku workflow inventory was prepared and OpenSpec validated. The canonical workflow's campaign readiness/verification gate does not support this standalone Vite project: it reports missing `3D.js` as canonical runtime divergence. The application has no Sataku runtime to synchronize, by design. The application's own Playwright fixture was used instead; no canonical harness pass is claimed.
