import assert from "node:assert/strict";
import { test } from "node:test";

import { transportFromStatementClient } from "../dist/adapters.js";
import { createStatementNotifier } from "../dist/index.js";
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
