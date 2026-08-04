# @minato-32/statement-notify

## 0.1.2

### Patch Changes

- 5871cf5: Fix: `PersistentRecordStore.hydrate()` now notifies listeners after loading persisted records. A feed (or `useSyncExternalStore` snapshot) built before an async hydrate resolves was left showing the empty pre-hydrate state until the next write; it now re-derives as soon as hydration completes. Consumers that already `await hydrate()` before first render are unaffected.

## 0.1.1

### Patch Changes

- 67101c7: Supply-chain hardening: publish with npm provenance, add repository metadata, pin CI actions to commit SHAs, and add Dependabot plus a security policy. No runtime code changes.
