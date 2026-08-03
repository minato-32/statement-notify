/** Adapters wrapping the Polkadot SDK primitives (`@parity/product-sdk-*`, or the
 *  `@novasamatech/*` line) into this package's injectable interfaces. Typed
 *  structurally (no SDK imports) so deep SDK types never leak into consumers. */

import type {
  KvBackend,
  NotifyTransport,
  PublishLike,
  PushInput,
  PushSink,
  StatementMeta,
} from "./types.js";

// ─── KV backend ──────────────────────────────────────────────────────────────

/**
 * A `LocalKvStore` from `@parity/product-sdk-local-storage` already matches
 * {@link KvBackend} structurally; this identity helper documents the intent and
 * type-checks the shape.
 */
export function kvBackendFromLocalKvStore(store: KvBackend): KvBackend {
  return store;
}

// ─── Statement transport ─────────────────────────────────────────────────────

/** Minimal shape of the SDK's `Result<T, E>` (`@parity/result`). */
type ResultLike<E> = { ok: true } | { ok: false; error: E };

/** Structural subset of `StatementStoreClient` this adapter relies on. */
export interface StatementClientLike {
  subscribe<T>(
    callback: (statement: { data: T; channelHex?: string; topics?: string[] }) => void,
    options?: { topic2?: string },
  ): { unsubscribe: () => void };
  publish?<T>(
    data: T,
    options?: { channel?: string; topic2?: string; ttlSeconds?: number },
  ): Promise<ResultLike<unknown>>;
  isConnected?(): boolean;
}

/**
 * Wrap a connected `StatementStoreClient` as a {@link NotifyTransport}. Maps the
 * SDK's `ReceivedStatement` to `(data, meta)`, its `Unsubscribable` to an unsub
 * function, and its `Result` publish outcome to a resolving/rejecting promise.
 */
export function transportFromStatementClient(client: StatementClientLike): NotifyTransport {
  const publish = client.publish;
  const transport: NotifyTransport = {
    subscribe: <T>(
      onData: (data: T, meta: StatementMeta) => void,
      options?: { topic2?: string },
    ): (() => void) => {
      const handle = client.subscribe<T>(
        (statement) =>
          onData(statement.data, {
            channelHex: statement.channelHex,
            topics: statement.topics,
          }),
        options,
      );
      return () => handle.unsubscribe();
    },
  };
  if (publish) {
    transport.publish = async <T>(data: T, options?: PublishLike): Promise<void> => {
      const result = await publish<T>(data, options);
      if (!result.ok) {
        throw result.error instanceof Error ? result.error : new Error("publish rejected");
      }
    };
  }
  if (client.isConnected) {
    transport.isConnected = () => client.isConnected?.() ?? false;
  }
  return transport;
}

// ─── Push side-channel ───────────────────────────────────────────────────────

/** Structural subset of the SDK's `NotificationManager`. */
export interface NotificationManagerLike {
  push(input: unknown): Promise<unknown>;
  cancel?(id: unknown): Promise<void>;
}

/**
 * Wrap a host `NotificationManager` (`getNotificationManager()`) as a
 * {@link PushSink}. `mapInput` translates this package's {@link PushInput} into
 * the host's push-request shape — required, because that shape is host-specific
 * (RFC-0019) and this package deliberately does not hard-code it.
 */
export function pushSinkFromNotificationManager(
  manager: NotificationManagerLike,
  mapInput: (input: PushInput) => unknown,
): PushSink {
  const sink: PushSink = {
    push: (input: PushInput) => manager.push(mapInput(input)),
  };
  if (manager.cancel) {
    sink.cancel = (id: unknown) => manager.cancel?.(id) ?? Promise.resolve();
  }
  return sink;
}
