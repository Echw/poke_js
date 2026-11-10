# Design

ICEMIST4 uses modulo-256 temporal subtraction for existing 8-bit palette indices, with independent four-frame gzip-9 segments. ICEMIST3 keeps XOR decoding for existing 8/12/16-bit clips. The simulation contract remains v3; the container's magic and predictor identify compression. Frame hashes and palettes must be identical across transcoding.

Startup leases acquire four compressed stores and three texture requests immediately. Stores retain their existing two-download limit; only sequential effect preparation decodes segments and uses the renderer. Failed prefetch leases release themselves; successfully acquired effect leases survive prefetch release. Last-owner disposal handles late texture responses.

Compilation targets existing drawable objects with the original scene as targetScene. Compiling roots containing lights would count those lights twice; drawable targets avoid that. Original GLB meshes are captured before effects attach to the model. The card's inactive manifestation roots are excluded during synchronous compiler traversal, with children restored before yielding. The four warmup times and depth/transmission/volume passes remain, plus targeted depth/geometry passes at 2.20 seconds for the transient card manifestation and buffers. This does not decode additional smoke segments or render another volume. Playback and warmup use the same depth-pass helper. Full motion tests assert that no intermediate state introduces a new program.

A Vite virtual module supplies normalized source hashes in development and production, with source-watcher invalidation. GLB parsing and hashing consume the same fetched buffer. A development-only dynamic authoring module preserves synchronous debug APIs after ready.
