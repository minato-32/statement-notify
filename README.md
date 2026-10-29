# @minato-32/statement-notify

A cross-platform, reactive **in-app notification store** for web apps.

You give it a message source (any `subscribe`) and a storage backend; it gives
you a durable, deduped notification **feed** with read/unread state and a
reactive unread badge — one data layer that drives a bell, a toast, and a full
center identically, and survives reloads and app restarts.

## Why

- **Survives IndexedDB-stripped WebViews.** Persistence auto-selects **host KV →
  browser `localStorage` → memory**, so it keeps working in sandboxed WebViews
  that delete `window.indexedDB` — where an IndexedDB store (Dexie, etc.) can't
  even open.
- **Durable, rehydrating feed.** Decoded messages are pinned to storage and
  restored on boot, on top of an ephemeral, replay-then-stream source.
- **Hardened writes.** Single-in-flight, timeout, read-back verify, bounded
  retry, debounced coalescing, flush on `visibilitychange`/`pagehide` — for
  key-value backends that silently swallow write failures.
- **Silent-deaf recovery.** A watchdog re-subscribes on visibility/focus/interval
  to recover a receive-only subscription that goes deaf when a host transport is
  disposed/rebound with no error.

## Install

```sh
npm i @minato-32/statement-notify
```

Everything is injected, so the core has no runtime deps. `react` is an optional
peer (for `/react`); the Polkadot SDK adapters (`/adapters`) optionally pair with
`@parity/product-sdk-*`.

Pick the line that matches your host. A host SDK release only talks to hosts on
its own truapi version (host SDK 0.29–0.30 → truapi 0.26, 0.31 → truapi 0.27),
so install the three SDK packages from the same release:

| statement-notify | npm tag | product-sdk-host | statement-store | local-storage | host truapi |
|---|---|---|---|---|---|
| `0.2.x` | `next` | `>=0.29 <1` | `>=0.7.4 <1` | `>=0.3.20 <1` | 0.26, 0.27 |
| `0.1.x` | `latest` | `0.14.x` | `0.6.1`–`0.6.2` | `0.3.1`–`0.3.2` | 0.5 |

```sh
npm i @minato-32/statement-notify@next   # latest hosts
```

## Quick start

```ts
import { createStatementNotifier } from "@minato-32/statement-notify";

type Wire = { kind: string; id: string; from: string; amount: string; ts: number };

const notifier = await createStatementNotifier<Wire, Wire>({
  name: "trades",
  schemaVersion: 1,
  // Inject any subscribe source (see /adapters for a Polkadot SDK adapter,
  // or /testing for a scriptable one). Omit `kv` to fall back to localStorage.
  transport,
  kv,
  // The only domain code you write: map a message to a feed record, or null to skip.
  toRecord: (data) =>
    data.kind === "trade-request"
      ? { id: data.id, ts: data.ts, payload: data, route: `/trades/${data.id}` }
      : null,
});

notifier.feed; // the reactive notification feed
notifier.tier; // "host" | "browser" | "memory" — where data persists
```

## React

```tsx
import { useNotifications, useUnreadCount } from "@minato-32/statement-notify/react";

function Bell({ feed }) {
  const count = useUnreadCount(feed);
  return <span>🔔 {count > 0 && <b>{count}</b>}</span>;
}

function List({ feed }) {
  const { items } = useNotifications(feed);
  return (
    <ul>
      {items.map((n) => (
        <li key={n.id} onClick={() => feed.markRead(n.id)}>
          {n.payload.from} · {n.payload.amount}
        </li>
      ))}
    </ul>
  );
}
```

`feed.markRead(id)` / `markAllRead()` / `markSeen(id)` / `dismiss(id)` /
`clearAll()` mutate engagement state; the hooks re-render automatically.

## Filtering, search, grouping

Records carry optional `category` and `priority` (`"low" | "normal" | "high" |
"urgent"`) set by your `toRecord`:

```ts
import { queryRecords, groupByDay, categoriesOf } from "@minato-32/statement-notify";
import { useFeedQuery } from "@minato-32/statement-notify/react";

queryRecords(items, { category: "trade", unreadOnly: true, search: "swap", sort: "priority", limit: 20 });
groupByDay(items);   // Today / Yesterday / Earlier
categoriesOf(items); // distinct categories for filter tabs

const visible = useFeedQuery(feed, { unreadOnly: true, limit: 20 }); // reactive
```

## Preferences (mute / do-not-disturb)

```ts
import { createPreferences } from "@minato-32/statement-notify";

const prefs = createPreferences({ kv, name: "trades" }); // persisted if kv given
await prefs.hydrate();
prefs.muteCategory("system");
prefs.set({ dnd: { start: "22:00", end: "07:00" } }); // overnight-aware
```

Pass `preferences: prefs` to `createStatementNotifier` to suppress the OS-push
side-channel for muted categories / during DND. The in-app feed is never
suppressed.

## Toasts

A standalone toast store for async flows (independent of the feed):

```ts
import { createToastStore } from "@minato-32/statement-notify";
import { useToasts } from "@minato-32/statement-notify/react";

const toasts = createToastStore({ max: 4 });
await toasts.promise(submit(), { loading: "Submitting…", success: "Done", error: (e) => `Failed: ${e}` });
const active = useToasts(toasts);
```

## Durability tiers

`notifier.tier` reports where data persists:

| tier | when | survives reload / app restart |
|---|---|---|
| `host` | you injected a host key-value store | yes |
| `browser` | plain browser, `localStorage` available | yes |
| `memory` | no persistent storage available | no (session only) |

The last debounced write may be lost on an abrupt kill (async writes,
best-effort flush on teardown). Pair with a replayable source for durability.

## Adapters

The core consumes three small interfaces — `KvBackend`, `NotifyTransport`,
`PushSink` — so it isn't tied to any one platform. `/adapters` ships structural
wrappers for the Polkadot [`@parity/product-sdk`](https://www.npmjs.com/org/parity)
primitives (works with the older `@novasamatech/*` line too):

```ts
import {
  transportFromStatementClient,
  kvBackendFromLocalKvStore,
  pushSinkFromNotificationManager,
} from "@minato-32/statement-notify/adapters";
import { StatementStoreClient } from "@parity/product-sdk-statement-store";
import { createLocalKvStore } from "@parity/product-sdk-local-storage";
import { getNotificationManager } from "@parity/product-sdk-host";

const client = new StatementStoreClient({ appName: "my-app" });
await client.connect({ mode: "host" });
const kv = await createLocalKvStore({ prefix: "my-app" }).catch(() => undefined);
const manager = await getNotificationManager(); // null outside a container
const trusted = new Set(["0x…"]); // signer public keys you accept

const notifier = await createStatementNotifier({
  name: "trades",
  schemaVersion: 1,
  transport: transportFromStatementClient(client),
  kv: kv ? kvBackendFromLocalKvStore(kv) : undefined,
  // Maps to the host's { text, deeplink, scheduledAt } push request by default.
  push: manager ? pushSinkFromNotificationManager(manager) : undefined,
  toPush: (record) => ({ title: "New trade", route: `/trades/${record.id}` }),
  // Anyone can publish on an app's topic: accept only senders you trust.
  // Statements without a proof have no signerHex and are dropped here.
  toRecord: (data, meta) =>
    meta.signerHex && trusted.has(meta.signerHex)
      ? { id: data.id, ts: data.ts, payload: data }
      : null,
});
```

`signerHex` is copied from the statement's proof; the SDK does not re-check the
signature and relies on the statement store node having validated it.

Since statement-store 0.6.16 the store dedupes per (signer, channel), so the
same content published by two accounts is delivered twice. The feed dedupes by
`id`, so both deliveries collapse into one record as long as `id` comes from the
content. Put `signerHex` in the `id` only if you want one record per sender.

The host shows one line of text, so `toHostPushRequest` joins `title` and `body`
as `"title: body"`. Pass your own mapper as the second argument to change that.
Set `PushInput.at` (ms since epoch, in the future) to schedule a push; a past
time fires immediately.

## Testing

```ts
import { fakeKvBackend, scriptedTransport } from "@minato-32/statement-notify/testing";

const src = scriptedTransport([{ id: "a", ts: Date.now(), text: "hi" }]);
const n = await createStatementNotifier({
  name: "t", schemaVersion: 1, transport: src.transport, kv: fakeKvBackend(),
  toRecord: (d) => ({ id: d.id, ts: d.ts, payload: d }),
});
src.emit({ id: "b", ts: Date.now(), text: "live" });
```

Run the suite: `npm test`. A runnable browser demo lives in [`examples/demo`](./examples/demo).

## API surface

- `.` — `createStatementNotifier`, `PersistentRecordStore`, `NotificationFeed`,
  `ResilientKvStore` + backend fallbacks, `SubscriptionWatchdog`, query selectors,
  `createPreferences`, `createToastStore`, types.
- `/react` — `useNotifications`, `useUnreadCount`, `useRecords`, `useFeedQuery`,
  `usePreferences`, `useToasts`.
- `/adapters` — Polkadot SDK wrappers.
- `/testing` — `fakeKvBackend`, `scriptedTransport`.

## License

MIT
