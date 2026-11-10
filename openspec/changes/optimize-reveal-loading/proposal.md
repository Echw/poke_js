# Lossless reveal loading optimization

## Why
Startup downloads roughly 75 MB of desktop replay data and repeatedly compiles hidden effects. Keep all eighteen effects ready before search, with identical density fields, rendering and timing.

## What Changes
- Version the byte predictor, transcode existing clips without quantization, retain legacy decoding.
- Prefetch the chosen profile's four shared sources and effect texture leases before sequential GPU preparation.
- Compile only the current effect/model/card and retain representative real renders.
- Generate source hashes in Vite, share model bytes for parsing/hash validation, exclude authoring tools from production.

## Impact
Codec/export tooling, scene startup, replay validation, texture ownership and loading documentation. No new runtime dependency or changes to shader math.
