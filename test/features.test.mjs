import assert from "node:assert/strict";
import { test } from "node:test";

import {
  categoriesOf,
  createPreferences,
  createToastStore,
  groupByDay,
  isDndActive,
  isSuppressed,
  queryRecords,
} from "../dist/index.js";

const rec = (id, over = {}) => ({ id, ts: Date.now(), payload: {}, ...over });

test("queryRecords filters by category, unread, search, priority + sorts", () => {
  const items = [
    rec("a", { category: "trade", read: false, priority: "high", title: "swap now" }),
    rec("b", { category: "system", read: true, priority: "low", title: "update" }),
    rec("c", { category: "trade", read: false, priority: "normal", title: "hello" }),
  ];
  assert.equal(queryRecords(items, { category: "trade" }).length, 2);
  assert.equal(queryRecords(items, { unreadOnly: true }).length, 2);
  assert.equal(queryRecords(items, { search: "swap" }).length, 1);
  assert.equal(queryRecords(items, { minPriority: "high" }).length, 1);
  const byPriority = queryRecords(items, { sort: "priority" });
  assert.equal(byPriority[0].id, "a"); // high first
});

test("queryRecords paginates", () => {
  const items = Array.from({ length: 10 }, (_, i) => rec(String(i), { ts: i }));
  assert.equal(queryRecords(items, { limit: 3 }).length, 3);
  assert.equal(queryRecords(items, { limit: 3, offset: 9 }).length, 1);
});

test("categoriesOf + groupByDay", () => {
  const now = Date.now();
  const items = [
    rec("a", { ts: now, category: "trade" }),
    rec("b", { ts: now - 25 * 3600_000, category: "system" }),
  ];
  assert.deepEqual(categoriesOf(items), ["system", "trade"]);
  const groups = groupByDay(items, now);
  assert.ok(groups.some((g) => g.key === "today"));
  assert.ok(groups.some((g) => g.key === "earlier" || g.key === "yesterday"));
});

test("preferences: mute + DND drive isSuppressed", () => {
  const prefs = createPreferences();
  prefs.muteCategory("system");
  const snap = prefs.getSnapshot();
  assert.ok(isSuppressed(rec("a", { category: "system" }), snap));
  assert.ok(!isSuppressed(rec("b", { category: "trade" }), snap));

  const dndSnap = { mutedCategories: [], soundEnabled: true, dnd: { start: "00:00", end: "23:59" } };
  assert.ok(isDndActive(dndSnap, new Date(2020, 0, 1, 12, 0)));
  const offSnap = { mutedCategories: [], soundEnabled: true, dnd: { start: "22:00", end: "07:00" } };
  assert.ok(isDndActive(offSnap, new Date(2020, 0, 1, 23, 0))); // overnight window
  assert.ok(!isDndActive(offSnap, new Date(2020, 0, 1, 12, 0)));
});

test("toast store: add, cap, dismiss, promise lifecycle", async () => {
  const toasts = createToastStore({ max: 2, defaultDuration: 0 });
  toasts.add({ kind: "info", title: "1" });
  toasts.add({ kind: "info", title: "2" });
  toasts.add({ kind: "info", title: "3" });
  assert.equal(toasts.getSnapshot().length, 2); // capped, oldest dropped
  assert.equal(toasts.getSnapshot()[0].title, "2");

  const okId = await toasts.promise(Promise.resolve("done"), {
    loading: "working",
    success: (v) => `ok:${v}`,
    error: "failed",
  });
  assert.equal(okId, "done");
  assert.ok(toasts.getSnapshot().some((t) => t.kind === "success" && t.title === "ok:done"));

  await assert.rejects(
    toasts.promise(Promise.reject(new Error("boom")), {
      loading: "working",
      success: "ok",
      error: (e) => `err:${e.message}`,
    }),
  );
  assert.ok(toasts.getSnapshot().some((t) => t.kind === "error" && t.title === "err:boom"));
  toasts.dispose();
});

test("notifier suppresses push for muted categories", async () => {
  const { createStatementNotifier } = await import("../dist/index.js");
  const { scriptedTransport, fakeKvBackend } = await import("../dist/testing.js");
  const prefs = createPreferences();
  prefs.muteCategory("muted");
  const pushed = [];
  const src = scriptedTransport([]);
  const n = await createStatementNotifier({
    name: "push",
    schemaVersion: 1,
    transport: src.transport,
    kv: fakeKvBackend(),
    preferences: prefs,
    push: { push: (i) => (pushed.push(i), Promise.resolve()) },
    toPush: (r) => ({ title: r.id }),
    toRecord: (d) => ({ id: d.id, ts: d.ts, payload: d, category: d.category }),
    pushGate: { armDelayMs: 0, freshWindowMs: 1_000_000 },
  });
  await new Promise((r) => setTimeout(r, 10)); // let push arm
  src.emit({ id: "x", ts: Date.now(), category: "muted" });
  src.emit({ id: "y", ts: Date.now(), category: "trade" });
  await new Promise((r) => setTimeout(r, 10));
  assert.deepEqual(pushed.map((p) => p.title), ["y"]); // muted suppressed
  n.stop();
});
