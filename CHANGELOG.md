# @minato-32/statement-notify

## 0.2.0-next.0

### Minor Changes

- 9a09830: Support the new host SDK line (hosts on truapi 0.26 and 0.27). Optional peers are now `@parity/product-sdk-host` >=0.29 <1, `@parity/product-sdk-statement-store` >=0.7.4 <1 and `@parity/product-sdk-local-storage` >=0.3.20 <1. The old `^0.14` / `^0.6` peers made npm refuse to install next to newer SDKs; the adapters are structural, so the wider range avoids a new release for every SDK minor. These hosts cannot talk to older SDKs, so this line does not work with older hosts; 0.1.x supports host SDK 0.14.x only.

  - `StatementMeta` carries `signerHex` and `expiry`. Use `signerHex` to accept only trusted senders. Since statement-store 0.6.16 the store dedupes per (signer, channel); a content-derived record `id` still collapses repeat deliveries.
  - `PublishLike` accepts `decryptionKey`. Publishing through `transportFromStatementClient` now works with the SDK's `StatementStoreClient` (its `publish` was called without `this`).
  - `pushSinkFromNotificationManager` maps inputs with the new `toHostPushRequest` by default, producing the host's `{ text, deeplink?, scheduledAt? }` request. If you pass your own mapper, it must return that shape; omit it to use the default. `PushInput` gains an optional `at` for scheduled pushes.
  - Persisted records and the default search text handle `bigint` values (e.g. `expiry`). Decoding converts only exact `{ "$big": "<digits>" }` / `{ "$u8": "<base64>" }` tags and keeps a value that fails to decode, so one bad payload can no longer wipe the saved feed.

## 0.1.2

### Patch Changes

- 5871cf5: Fix: `PersistentRecordStore.hydrate()` now notifies listeners after loading persisted records. A feed (or `useSyncExternalStore` snapshot) built before an async hydrate resolves was left showing the empty pre-hydrate state until the next write; it now re-derives as soon as hydration completes. Consumers that already `await hydrate()` before first render are unaffected.

## 0.1.1

### Patch Changes

- 67101c7: Supply-chain hardening: publish with npm provenance, add repository metadata, pin CI actions to commit SHAs, and add Dependabot plus a security policy. No runtime code changes.
