# Repository instructions

## Mandatory V2 cache strategy

Before changing or deploying any V2 HTML, JavaScript, CSS, service worker, manifest, or other browser-cached asset, read and follow [`docs/V2_CACHE_STRATEGY.md`](docs/V2_CACHE_STRATEGY.md).

Treat the cache strategy as part of the feature implementation, not as deployment cleanup. A deployable V2 change is incomplete until its build identifier, module graph, app shell, updater, tests, deployment verification, and—when required—unique recovery page are handled according to that runbook.

Do not solve a stale-client report by inventing another query parameter or deleting all browser storage. Use the documented recovery flow, which preserves collection data and settings.
