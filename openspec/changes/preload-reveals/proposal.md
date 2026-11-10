# Preload Pokémon reveals

Prepare every reveal behind an initial loader, retain ready effects, share Fighting/Ghost replay data, persist validated replay assets across visits, and bound card/query caches. Preserve all visual timelines and the single renderer. New card API latency remains outside effect preparation.

Acceptance: 18 ready effects before search, four unique clips per device profile, no effect downloads or initial segment decoding on subsequent selections, retryable startup, bounded retained buffers, unchanged decoded frames and appearance, production cache reuse with corruption/quota recovery.
