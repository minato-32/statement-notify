/** Test doubles so the persistence + ingest path is CI-testable without a host. */

import type { NotifyTransport, StatementMeta } from "./types.js";

export { memoryKvBackend as fakeKvBackend } from "./resilient-kv.js";

/** A scriptable {@link NotifyTransport} for tests: replays an optional backlog to
 *  each new subscriber, then lets the test push live events via `emit`. */
export interface ScriptedTransport<T> {
  transport: NotifyTransport;
  /** Deliver a live event to all current subscribers. */
  emit(data: T, meta?: StatementMeta): void;
  /** Number of active subscribers (assert the watchdog re-subscribes, etc.). */
  subscriberCount(): number;
}

export function scriptedTransport<T>(backlog: T[] = []): ScriptedTransport<T> {
  const subscribers = new Set<(data: T, meta: StatementMeta) => void>();
  const transport: NotifyTransport = {
    subscribe: <U>(
      onData: (data: U, meta: StatementMeta) => void,
      _options?: { topic2?: string },
    ): (() => void) => {
      const fn = onData as unknown as (data: T, meta: StatementMeta) => void;
      subscribers.add(fn);
      for (const item of backlog) fn(item, {});
      return () => {
        subscribers.delete(fn);
      };
    },
  };
  return {
    transport,
    emit: (data: T, meta: StatementMeta = {}) => {
      for (const fn of subscribers) fn(data, meta);
    },
    subscriberCount: () => subscribers.size,
  };
}
