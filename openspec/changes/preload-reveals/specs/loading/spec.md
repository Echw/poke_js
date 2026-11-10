## ADDED Requirements

### Requirement: Prepare every reveal before enabling search
The application SHALL keep search disabled behind an accessible startup loader until all eighteen reveal types have loaded their required assets, initialized GPU resources and retained their initial replay segments for the device profile selected at scene initialization.

#### Scenario: First visit
- **WHEN** a user opens the application with empty caches
- **THEN** the loader reports resource loading and completed effect counts, and search becomes usable only after all effects are ready
- **AND** each unique replay source is loaded once, with Fighting and Ghost sharing data

#### Scenario: Repeated selection
- **WHEN** a user selects an already prepared effect or restarts it after playback
- **THEN** its instance, shader programs and decoded startup segments are reused

### Requirement: Persist validated replay assets
The production application SHALL persist validated replay containers by content-hashed URL when browser storage is available, remove obsolete application entries and remain usable when persistence is denied.

#### Scenario: Return visit
- **WHEN** a validated cached container exists for the current asset URL
- **THEN** the worker reads it without downloading that container again
- **AND** the new page still prepares its own GPU resources

#### Scenario: Corrupt cache
- **WHEN** cached container validation fails
- **THEN** only the invalid entry is removed and fetched again before readiness is reported

### Requirement: Bound retained search and replay memory
The application SHALL retain two decoded startup segments per unique replay source and only the active source's current/next rolling segments. It SHALL cache at most fifty successful normalized card queries for thirty minutes and retain up to eight card textures within a 64 MiB estimated budget, excluding temporary outstanding leases.

#### Scenario: Many searches
- **WHEN** a user completes fifty consecutive searches
- **THEN** unused card textures are evicted and disposed without rebuilding reveal instances

### Requirement: Retry preparation failures without losing successful work
The application SHALL expose a Retry control when effect preparation fails and preserve already prepared effects. Failure to obtain the initial card SHALL allow search after effect preparation succeeds.

#### Scenario: Replay unavailable
- **WHEN** a required replay cannot be fetched or validated
- **THEN** the loader stays visible and the user can retry the failed preparation

#### Scenario: Initial card API unavailable
- **WHEN** the initial card API fails but all effects are ready
- **THEN** the loader closes and search is enabled with a useful status message
