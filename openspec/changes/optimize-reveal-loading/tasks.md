# Tasks

- [x] Capture baseline images and separate development/production startup measurements.
- [x] Implement versioned lossless transcoding and legacy decoding.
- [x] Implement early asset leases, shared textures, scoped GPU preparation and lean production imports.
- [x] Validate every decoded frame, legacy compatibility, retries and ownership.
- [x] Compare all reveal images and motion on both profiles; run loading/idle/effect regressions.
- [x] Measure candidate startup/decode/GPU preparation and document results and limitations.

Performance acceptance remains open: the final startup sample was slower than baseline and desktop playback still reported buffering transitions. Transfer reduction and exact decoded data are verified; end-to-end acceleration and absence of additional stalls are not established. See `docs/LOADING.md` for measurements and limits.
