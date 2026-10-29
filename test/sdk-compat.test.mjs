import assert from "node:assert/strict";
import { test } from "node:test";

import {
  pushSinkFromNotificationManager,
  toHostPushRequest,
  transportFromStatementClient,
} from "../dist/adapters.js";
import { createStatementNotifier, queryRecords } from "../dist/index.js";
import { fakeKvBackend } from "../dist/testing.js";

/** A fake StatementStoreClient shaped like product-sdk-statement-store 0.7. */
function fakeClient() {
  const callbacks = new Set();
  const published = [];
  return {
    published,
    deliver: (statement) => {
      for (const cb of callbacks) cb(statement);
    },
    client: {
      subscribe: (cb) => {
        callbacks.add(cb);
        return { unsubscribe: () => callbacks.delete(cb) };
      },
      publish: async (data, options) => {
        published.push({ data, options });
        return data === "reject" ? { ok: false, error: new Error("too large") } : { ok: true };
      },
      isConnected: () => true,
    },
  };
}

test("statement adapter forwards signer and expiry", () => {
  const { client, deliver } = fakeClient();
  const transport = transportFromStatementClient(client);
  const got = [];
  const unsub = transport.subscribe((data, meta) => got.push({ data, meta }));
  deliver({
    data: { id: "x" },
    channelHex: "0xc1",
    topics: ["0xt1"],
    signerHex: "0xaa",
    expiry: 42n,
    raw: {},
  });
  assert.deepEqual(got[0].meta, {
    channelHex: "0xc1",
    topics: ["0xt1"],
    signerHex: "0xaa",
    expiry: 42n,
  });
  unsub();
  deliver({ data: { id: "y" }, topics: [] });
  assert.equal(got.length, 1);
});

test("same content from two signers collapses by content id, or splits by signer", async () => {
  const run = async (toId) => {
    const { client, deliver } = fakeClient();
    const n = await createStatementNotifier({
      name: "signers",
      schemaVersion: 1,
      transport: transportFromStatementClient(client),
      kv: fakeKvBackend(),
      watchdog: { enabled: false },
      toRecord: (d, meta) => ({ id: toId(d, meta), ts: d.ts, payload: d }),
    });
    const data = { id: "same", ts: Date.now() };
    deliver({ data, topics: [], signerHex: "0xaa" });
    deliver({ data, topics: [], signerHex: "0xbb" });
    const count = n.feed.getSnapshot().items.length;
    n.stop();
    return count;
  };
  assert.equal(await run((d) => d.id), 1);
  assert.equal(await run((d, meta) => `${meta.signerHex}:${d.id}`), 2);
});

test("publish forwards decryptionKey and rejects on an err Result", async () => {
  const { client, published } = fakeClient();
  const transport = transportFromStatementClient(client);
  const key = new Uint8Array(32);
  await transport.publish({ a: 1 }, { topic2: "room", decryptionKey: key });
  assert.equal(published[0].options.decryptionKey, key);
  await assert.rejects(transport.publish("reject"), /too large/);
});

test("publish keeps the client's this, like the SDK's class-based client", async () => {
  class Client {
    sent = [];
    subscribe() {
      return { unsubscribe() {} };
    }
    async publish(data) {
      this.sent.push(data);
      return { ok: true };
    }
  }
  const client = new Client();
  await transportFromStatementClient(client).publish({ a: 1 });
  assert.deepEqual(client.sent, [{ a: 1 }]);
});

test("toHostPushRequest builds the host's push request shape", () => {
  assert.deepEqual(toHostPushRequest({ title: "Trade" }), { text: "Trade" });
  assert.deepEqual(
    toHostPushRequest({ title: "Trade", body: "accepted", route: "/t/1", at: 4102444800000.7 }),
    { text: "Trade: accepted", deeplink: "/t/1", scheduledAt: 4102444800000n },
  );
  // An invalid or past time fires immediately instead of throwing out of push().
  assert.deepEqual(toHostPushRequest({ title: "Trade", at: Number.NaN }), { text: "Trade" });
  assert.deepEqual(toHostPushRequest({ title: "Trade", at: -1 }), { text: "Trade" });
  assert.deepEqual(toHostPushRequest({ title: "Trade", at: Date.now() - 5_000 }), { text: "Trade" });
  // An empty title doesn't leave a stray separator.
  assert.deepEqual(toHostPushRequest({ title: "", body: "accepted" }), { text: "accepted" });
});

test("push sink maps with the default mapper and cancels by numeric id", async () => {
  const sent = [];
  const cancelled = [];
  const sink = pushSinkFromNotificationManager({
    push: async (input) => {
      sent.push(input);
      return 7;
    },
    cancel: async (id) => {
      cancelled.push(id);
    },
  });
  const id = await sink.push({ title: "Hi", body: "there" });
  await sink.cancel(id);
  assert.deepEqual(sent, [{ text: "Hi: there" }]);
  assert.deepEqual(cancelled, [7]);
});

test("records holding a bigint (e.g. statement expiry) persist and search", async () => {
  const kv = fakeKvBackend();
  const { client, deliver } = fakeClient();
  const opts = {
    name: "bigint",
    schemaVersion: 1,
    kv,
    persist: { debounceMs: 1 },
    watchdog: { enabled: false },
    toRecord: (d, meta) => ({ id: d.id, ts: d.ts, payload: { ...d, expiry: meta.expiry } }),
  };
  const n1 = await createStatementNotifier({ ...opts, transport: transportFromStatementClient(client) });
  deliver({ data: { id: "a", ts: Date.now(), text: "hello" }, topics: [], expiry: 2n ** 40n });
  n1.flush();
  await new Promise((r) => setTimeout(r, 30));
  n1.stop();
  const n2 = await createStatementNotifier({
    ...opts,
    transport: transportFromStatementClient(fakeClient().client),
  });
  assert.equal(n2.store.get("a").payload.expiry, 2n ** 40n);
  assert.equal(queryRecords(n2.store.getAll(), { search: "hello" }).length, 1);
  n2.stop();
});

test("a payload with tag-like keys survives a restart without wiping the feed", async () => {
  const kv = fakeKvBackend();
  const opts = {
    name: "tags",
    schemaVersion: 1,
    kv,
    persist: { debounceMs: 1 },
    watchdog: { enabled: false },
    toRecord: (d) => ({ id: d.id, ts: d.ts, payload: d }),
  };
  const { client, deliver } = fakeClient();
  const n1 = await createStatementNotifier({ ...opts, transport: transportFromStatementClient(client) });
  const ts = Date.now();
  deliver({ data: { id: "ok", ts, big: 5n, bytes: new Uint8Array([1, 2, 3]) }, topics: [] });
  deliver({ data: { id: "extra", ts, meta: { $big: "5", note: "keep me" } }, topics: [] });
  deliver({ data: { id: "badBig", ts, meta: { $big: "zz" } }, topics: [] });
  deliver({ data: { id: "badU8", ts, meta: { $u8: "%%%" } }, topics: [] });
  deliver({ data: { id: "loose", ts, meta: { $big: "0x10" } }, topics: [] });
  n1.flush();
  await new Promise((r) => setTimeout(r, 30));
  n1.stop();
  const n2 = await createStatementNotifier({
    ...opts,
    transport: transportFromStatementClient(fakeClient().client),
  });
  assert.equal(n2.store.getAll().length, 5);
  // Real tags still decode next to the bad ones.
  assert.equal(n2.store.get("ok").payload.big, 5n);
  assert.deepEqual(n2.store.get("ok").payload.bytes, new Uint8Array([1, 2, 3]));
  assert.deepEqual(n2.store.get("extra").payload.meta, { $big: "5", note: "keep me" });
  assert.deepEqual(n2.store.get("badBig").payload.meta, { $big: "zz" });
  assert.deepEqual(n2.store.get("badU8").payload.meta, { $u8: "%%%" });
  assert.deepEqual(n2.store.get("loose").payload.meta, { $big: "0x10" });
  n2.stop();
});
