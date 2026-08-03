# statement-notify demo

A runnable local app that exercises **every** feature of `@minato-32/statement-notify`
with a scripted statement source (you drive statements via buttons) and **real**
browser-localStorage persistence.

## Run

```sh
# from the package root, build it once (the demo links ../.. via file:)
npm run build

# then the demo
cd examples/demo
npm install
npm run dev        # → http://localhost:5173
```

## What you can test (all real)

| Action | Verifies |
|---|---|
| **Emit** buttons (category × priority) | live ingest → feed updates with no refetch |
| **Emit duplicate id** | dedupe (appears once) |
| Search / category / sort / unread-only | `queryRecords` filter/search/priority-sort |
| Day sections | `groupByDay` |
| read / dismiss / mark-all-read / clear-all | engagement state + reactive unread badge |
| **mute** a category / **DND** toggle | preference-gated push (📢 toast is suppressed; the in-app feed still records) |
| Toast buttons | `createToastStore` + `promise()` success/error lifecycle |
| **Reload the page** | persistence — items + read-state survive (localStorage) |
| `persistence: <tier>` in the header | `notifier.tier` (`browser` here; `host` in a container) |

## Real host path

This demo swaps in a scripted transport + localStorage. To test against **real**
statements + the host KV (the IndexedDB-stripped mobile case), inject the SDK
adapters instead — the notifier code is identical:

```ts
import { transportFromStatementClient, kvBackendFromLocalKvStore } from "@minato-32/statement-notify/adapters";
// transport: transportFromStatementClient(statementStoreClient)
// kv:        kvBackendFromLocalKvStore(await createLocalKvStore(...))
```

Run that build inside the Polkadot host (desktop, then mobile) to earn the
on-device proof.
