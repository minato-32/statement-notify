/** Wires the package together for the demo: a scripted transport you drive with
 *  buttons, real browser-localStorage persistence, a preferences store, and a
 *  toast store. Push is simulated by adding a toast so preference-suppression is
 *  visible. This is exactly the ~30 lines a real Product writes (plus real SDK
 *  adapters instead of the scripted transport). */

import {
  browserLocalStorageBackend,
  createPreferences,
  createStatementNotifier,
  createToastStore,
  type NotifyPriority,
  type Notifier,
} from "@minato-32/statement-notify";
import { scriptedTransport } from "@minato-32/statement-notify/testing";

/** The decoded statement payload for this demo. */
export interface Wire {
  id: string;
  category: string;
  priority: NotifyPriority;
  title: string;
  body: string;
  ts: number;
  route?: string;
}

export const toasts = createToastStore({ max: 4 });

// Real persistence: localStorage in the browser (survives reload). In a host,
// you'd inject the host KV here instead — the notifier code is identical.
const kv = browserLocalStorageBackend() ?? undefined;

export const prefs = createPreferences({ kv, name: "demo" });

export const source = scriptedTransport<Wire>([]);

export type DemoNotifier = Notifier<Wire>;

export async function initNotifier(): Promise<DemoNotifier> {
  await prefs.hydrate();
  return createStatementNotifier<Wire, Wire>({
    name: "demo",
    schemaVersion: 1,
    transport: source.transport,
    kv,
    preferences: prefs,
    // Simulated OS push → a toast, so muted/DND suppression is visible.
    push: {
      push: (input) => {
        toasts.add({ kind: "info", title: `📢 ${input.title}`, message: input.body });
        return Promise.resolve();
      },
    },
    toPush: (record) => ({
      title: record.payload.title,
      body: record.payload.body,
      ...(record.payload.route ? { route: record.payload.route } : {}),
    }),
    toRecord: (data) => ({
      id: data.id,
      ts: data.ts,
      payload: data,
      category: data.category,
      priority: data.priority,
      title: data.title,
      body: data.body,
      route: data.route,
    }),
    pushGate: { armDelayMs: 0, freshWindowMs: 10 * 60_000 },
  });
}

let counter = 0;

/** Emit a fresh statement of the given category/priority through the transport. */
export function emit(category: string, priority: NotifyPriority): void {
  counter += 1;
  const id = `${category}-${Date.now().toString(36)}-${counter}`;
  source.emit({
    id,
    category,
    priority,
    title: `${category} #${counter}`,
    body: `A ${priority}-priority ${category} event`,
    ts: Date.now(),
    route: `/x/${id}`,
  });
}

/** Emit the SAME id twice to demonstrate dedupe. */
export function emitDuplicate(): void {
  const dup = { id: "dup-fixed", category: "trade", priority: "normal" as const, title: "Duplicate", body: "sent twice — appears once", ts: Date.now() };
  source.emit(dup);
  source.emit({ ...dup, ts: Date.now() });
}
