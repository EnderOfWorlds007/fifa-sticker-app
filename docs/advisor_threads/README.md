# Advisor threads

Substantive advisor findings are stored here so design and implementation
decisions do not depend on transient task transcripts.

| Thread ID | Title | Mission | Status | Findings |
| --- | --- | --- | --- | --- |
| `01a09218-bd86-7dc3-9bb3-b1f3a720f15a` | SOL review: high-contrast estimated card geometry | Review color, outline, label, accessibility, interaction semantics, and the resulting implementation for display-only estimated card geometry. | Four initial and two re-review P2 findings addressed; final re-review APPROVE with no remaining P0/P1/P2. | [`high-contrast-estimated-geometry-review.md`](high-contrast-estimated-geometry-review.md) |
| `01a091b9-b6ed-74d0-8464-3ebb767ea520` | SOL review: estimated recovered geometry implementation | Review mobile marker rendering, review semantics, backend authority separation, cache compliance, and tests for the CAN15 correction. | Complete; initial backend hit-testing P2 addressed, final re-review APPROVE with no remaining P0/P1/P2 findings. | [`estimated-recovered-geometry-review.md`](estimated-recovered-geometry-review.md) |
| `01a02b13-7b0b-7bf0-91be-d8d0aca08c15` | SOL review: child-friendly v2 UX package | Review the v2 child-friendly journeys, tutorial strategy, storyboard, safety, accessibility, and implementation risks. | Complete | [`child-friendly-v2-ux-review.md`](child-friendly-v2-ux-review.md) |
| `01a03a5e-0f92-7cc0-b750-1e1383ee5494` | SOL review: public V2 collection model refactor | Review shared V2 album ownership semantics, scanner integration, tests, and deployment/cache risks. | Complete | [`public-v2-collection-model-refactor-review.md`](public-v2-collection-model-refactor-review.md) |
| `01a03d5a-e805-7810-bc34-e05e582e7164` | SOL review: V2 in-app flash capture | Review the shared controlled camera design, truthful flash/torch diagnostics, lifecycle cleanup, tests, and PWA cache risks. | Complete | [`v2-in-app-flash-capture-review.md`](v2-in-app-flash-capture-review.md) |
| `01a03da4-8a4c-78b2-9550-c93a891969a1` | SOL review: iOS capture timeout fix | Review the bounded native still-photo timeout, preview-frame fallback, lifecycle races, regression coverage, and cache refresh. | Superseded by subsequent real-device stall | [`v2-ios-capture-timeout-review.md`](v2-ios-capture-timeout-review.md) |
| `01a03da4-8a4c-78b2-9550-c93a891969a1` (follow-up) | SOL review: iOS ImageCapture bypass | Review the Apple-mobile native-still bypass after the timer fix could not prevent a real iPhone WebKit stall. | Complete; findings addressed | [`v2-ios-imagecapture-bypass-review.md`](v2-ios-imagecapture-bypass-review.md) |
| `01a03dba-9733-7290-ba71-2c1f586a3120` | SOL review: force V2 cache refresh | Review stale-worker escape, reset-page safety, controller takeover, versioned app-shell caching, offline behavior, and tests. | Complete; findings addressed | [`v2-force-cache-refresh-review.md`](v2-force-cache-refresh-review.md) |
