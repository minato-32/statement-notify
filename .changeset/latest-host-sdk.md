---
"@minato-32/statement-notify": minor
---

Support the latest host SDK line (truapi 0.26). Optional peers are now `@parity/product-sdk-host` >=0.29 <1, `@parity/product-sdk-statement-store` >=0.7.4 <1 and `@parity/product-sdk-local-storage` >=0.3.20 <1. The old `^0.14` / `^0.6` peers made npm refuse to install next to newer SDKs; the adapters are structural, so the wider range avoids a new release for every SDK minor. These hosts speak a new wire codec, so this line does not work with older hosts; stay on 0.1.x for those.

- `StatementMeta` carries `signerHex` and `expiry`. Use `signerHex` to accept only trusted senders. The store now dedupes per (signer, channel); a content-derived record `id` still collapses repeat deliveries.
- `PublishLike` accepts `decryptionKey`.
- `pushSinkFromNotificationManager` maps inputs with the new `toHostPushRequest` by default, producing the host's `{ text, deeplink, scheduledAt }` request. `PushInput` gains an optional `at` for scheduled pushes.
