## ADDED Requirements

### Requirement: Lossless optimized startup
The application SHALL preload all eighteen effects using identical decoded replay fields, visual settings and animation timing while eliminating redundant downloads and shader preparation.

#### Scenario: Current and legacy containers
- **WHEN** a supported current or legacy replay is decoded
- **THEN** every frame matches its density SHA-256 and keeps the same source-frame mapping

#### Scenario: First search after startup
- **WHEN** the loader finishes and a successful search selects any reveal
- **THEN** no effect asset download, effect construction or shader compilation is required
- **AND** startup remains a static closed Pokeball before that search

#### Scenario: Failure and disposal
- **WHEN** a prefetched resource fails or the scene is disposed
- **THEN** its leases settle without unhandled rejections or leaked workers/textures
- **AND** retry preserves successfully prepared resources
