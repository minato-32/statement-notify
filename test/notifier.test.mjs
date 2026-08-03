import assert from "node:assert/strict";
import { test } from "node:test";

import { createStatementNotifier } from "../dist/index.js";
import { fakeKvBackend, scriptedTransport } from "../dist/testing.js";

const tick = (ms = 30) => new Promise((r) => setTimeout(r, ms));
const rec = (id, text) => ({ id, ts: Date.now(), text });

test("backlog replays into the feed with an unread badge", async () => {
  const src = scriptedTransport([rec("a", "hello")]);
  const n = await createStatementNotifier({
    name: "t1",
    schemaVersion: 1,
    transport: src.transport,
    kv: fakeKvBackend(),
    toRecord: (d) => ({ id: d.id, ts: d.ts, payload: d }),
  });
  assert.equal(n.feed.getSnapshot().items.length, 1);
  assert.equal(n.feed.getSnapshot().unreadCount, 1);
  n.stop();
});

test("live emit, dedup by id, and mark-all-read", async () => {
  const src = scriptedTransport([]);
  const n = await createStatementNotifier({
    name: "t2",
    schemaVersion: 1,
    transport: src.transport,
    kv: fakeKvBackend(),
    toRecord: (d) => ({ id: d.id, ts: d.ts, payload: d }),
  });
  src.emit(rec("a", "one"));
  src.emit(rec("b", "two"));
  assert.equal(n.feed.getSnapshot().items.length, 2);
  assert.equal(n.feed.getSnapshot().unreadCount, 2);

  src.emit({ id: "a", ts: Date.now(), text: "dup" }); // duplicate id → ignored
  assert.equal(n.feed.getSnapshot().items.length, 2);

  n.feed.markAllRead();
  assert.equal(n.feed.getSnapshot().unreadCount, 0);
  n.stop();
});

test("state persists across a restart via the KV backend", async () => {
  const kv = fakeKvBackend(); // shared backend simulates the durable host KV
  const src1 = scriptedTransport([]);
  const n1 = await createStatementNotifier({
    name: "persist",
    schemaVersion: 1,
    transport: src1.transport,
    kv,
    toRecord: (d) => ({ id: d.id, ts: d.ts, payload: d }),
  });
  src1.emit(rec("a", "one"));
  src1.emit(rec("b", "two"));
  n1.feed.markRead("a");
  n1.flush();
  await tick();
  n1.stop();

  // Fresh notifier, same KV + name → should rehydrate both records + read state.
  const src2 = scriptedTransport([]);
  const n2 = await createStatementNotifier({
    name: "persist",
    schemaVersion: 1,
    transport: src2.transport,
    kv,
    toRecord: (d) => ({ id: d.id, ts: d.ts, payload: d }),
  });
  const view = n2.feed.getSnapshot();
  assert.equal(view.items.length, 2);
  assert.equal(view.unreadCount, 1); // "a" was read, "b" still unread
  n2.stop();
});

test("a schema-version bump discards incompatible persisted data", async () => {
  const kv = fakeKvBackend();
  const src1 = scriptedTransport([]);
  const n1 = await createStatementNotifier({
    name: "ver",
    schemaVersion: 1,
    transport: src1.transport,
    kv,
    toRecord: (d) => ({ id: d.id, ts: d.ts, payload: d }),
  });
  src1.emit(rec("a", "one"));
  n1.flush();
  await tick();
  n1.stop();

  const src2 = scriptedTransport([]);
  const n2 = await createStatementNotifier({
    name: "ver",
    schemaVersion: 2, // bumped → old blob rejected → starts empty
    transport: src2.transport,
    kv,
    toRecord: (d) => ({ id: d.id, ts: d.ts, payload: d }),
  });
  assert.equal(n2.feed.getSnapshot().items.length, 0);
  n2.stop();
});
