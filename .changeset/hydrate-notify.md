---
"@minato-32/statement-notify": patch
---

Fix: `PersistentRecordStore.hydrate()` now notifies listeners after loading persisted records. A feed (or `useSyncExternalStore` snapshot) built before an async hydrate resolves was left showing the empty pre-hydrate state until the next write; it now re-derives as soon as hydration completes. Consumers that already `await hydrate()` before first render are unaffected.
