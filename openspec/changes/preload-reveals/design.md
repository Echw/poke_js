# Design

`prepareReveal(type)` deduplicates and serializes GPU preparation; `prepareAllReveals(progress)` is the UI readiness barrier. Reuse existing effect factories, depth compilation and fog warmup, then reset the timeline. Freeze the existing mobile breakpoint at scene initialization.

Reference-count replay stores by URL. One worker owns each compressed file; share startup chunks and retain only the active rolling pair. Keep separate effect render targets. Cache validated production containers by content-hashed URL, prune obsolete entries, and treat disk failures as optional acceleration failures. Scene-owned leased texture LRU and normalized TTL query cache accelerate repeated searches.

The loader reports stages and completed effects, not simulated percentage. Failed effects are retryable without rebuilding successful owners. Production startup requires replay readiness; explicit developer live simulation remains supported. Use existing debug handles and QA fixtures; no new renderer, RAF, global production API or Sataku runtime.
