/** `createStatementNotifier` — the bridge that ties the pieces into a drop-in
 *  in-app notification system. Subscribes to the injected transport, maps each
 *  message to a feed record via `toRecord`, accumulates it into the durable
 *  {@link PersistentRecordStore}, exposes a {@link NotificationFeed}, and fires
 *  an optional OS-push side-channel for fresh records. Watchdog-managed
 *  subscription; host-KV → browser → memory persistence. */

import { NotificationFeed } from "./notification-feed.js";
import { isSuppressed, type PreferencesStore } from "./preferences.js";
import { PersistentRecordStore } from "./record-store.js";
import { ResilientKvStore, resolveKvBackend } from "./resilient-kv.js";
import { NotifyError } from "./types.js";
import type {
  KvBackend,
  NotifyRecord,
  NotifyTransport,
  PublishLike,
  PushInput,
  PushSink,
  StatementMeta,
} from "./types.js";
import { SubscriptionWatchdog } from "./watchdog.js";

/** Active persistence durability tier — surface it so a Product can warn the
 *  user when notifications are session-only. */
export type DurabilityTier = "host" | "browser" | "memory";

export interface NotifierOptions<T, P> {
  /** Unique namespace — used for the KV key and to scope the store. */
  name: string;
  /** Consumer record-schema version; bump to invalidate persisted data. */
  schemaVersion: number;
  /** Injectable statement transport (see `/adapters`). */
  transport: NotifyTransport;
  /**
   * Map a decoded statement payload to a feed record, or `null` to ignore it.
   * This is the sole required piece of domain logic. `id` must be stable and
   * content-idempotent so backlog replays dedupe cleanly.
   */
  toRecord: (data: T, meta: StatementMeta) => NotifyRecord<P> | null;
  /** Persistence target (host KV). Omit → browser localStorage → memory fallback. */
  kv?: KvBackend | null;
  /** Optional OS-push side-channel (see `/adapters`). */
  push?: PushSink;
  /** Build an OS-push payload for a fresh record, or `null` to skip push for it. */
  toPush?: (record: NotifyRecord<P>) => PushInput | null;
  /** Optional preferences store — mutes push for muted categories / DND windows. */
  preferences?: PreferencesStore;
  /** Secondary topic filter passed to the transport subscription. */
  topic2?: string;
  /** Max records retained (default 500). */
  maxRecords?: number;
  /** Persistence timing overrides. */
  persist?: {
    debounceMs?: number;
    timeoutMs?: number;
    maxRetries?: number;
  };
  /** Watchdog config. `enabled: false` subscribes once with no recovery. */
  watchdog?: {
    enabled?: boolean;
    intervalMs?: number;
    minIntervalMs?: number;
  };
  /** Gate OS-push so backlog replay on load doesn't fire a burst. */
  pushGate?: {
    /** Suppress push for this long after start (default 1500ms). */
    armDelayMs?: number;
    /** Only push for records newer than this age (default 60_000ms). */
    freshWindowMs?: number;
  };
  /** Non-fatal error sink (KV give-up, etc.). Never throws into callers. */
  onError?: (err: NotifyError) => void;
}

export interface Notifier<P> {
  /** The in-app notification feed (bell/toast/center data source). */
  feed: NotificationFeed<P>;
  /** The underlying record store, for advanced queries. */
  store: PersistentRecordStore<P>;
  /** Active persistence tier. */
  tier: DurabilityTier;
  /** Publish a statement, if the transport supports it. */
  publish<T>(data: T, options?: PublishLike): Promise<void>;
  /** Force-flush pending persistence (e.g. before a controlled teardown). */
  flush(): void;
  /** Tear everything down: unsubscribe, dispose store/feed, flush persistence. */
  stop(): void;
}

/** Create and start a statement-backed in-app notifier. */
export async function createStatementNotifier<T, P>(
  options: NotifierOptions<T, P>,
): Promise<Notifier<P>> {
  const { backend, tier } = resolveKvBackend(options.kv);

  const persister = new ResilientKvStore({
    backend,
    key: `statement-notify:${options.name}`,
    debounceMs: options.persist?.debounceMs,
    timeoutMs: options.persist?.timeoutMs,
    maxRetries: options.persist?.maxRetries,
    onError: options.onError,
  });

  const store = new PersistentRecordStore<P>({
    persister,
    schemaVersion: options.schemaVersion,
    maxRecords: options.maxRecords,
  });
  await store.hydrate();

  const feed = new NotificationFeed<P>(store);

  // ── OS-push gating ──────────────────────────────────────────────────────
  const armDelayMs = options.pushGate?.armDelayMs ?? 1_500;
  const freshWindowMs = options.pushGate?.freshWindowMs ?? 60_000;
  let armed = false;
  const armTimer = setTimeout(() => {
    armed = true;
  }, armDelayMs);

  const maybePush = (record: NotifyRecord<P>): void => {
    // Push is a best-effort side-channel; a throwing `toPush`/preferences read
    // must never break statement ingestion (this runs inside the sub callback).
    try {
      if (!armed || !options.push || !options.toPush) return;
      if (Date.now() - record.ts > freshWindowMs) return;
      if (options.preferences && isSuppressed(record, options.preferences.getSnapshot())) {
        return;
      }
      const input = options.toPush(record);
      if (input) void options.push.push(input).catch(() => undefined);
    } catch {
      /* swallow — never let the OS-push path break the feed */
    }
  };

  // ── Ingest ──────────────────────────────────────────────────────────────
  const ingest = (data: T, meta: StatementMeta): void => {
    let record: NotifyRecord<P> | null;
    try {
      record = options.toRecord(data, meta);
    } catch (err) {
      options.onError?.(toDecodeError(err));
      return;
    }
    if (!record) return;
    const isNew = store.add(record);
    if (isNew) maybePush(record);
  };

  // ── Subscription (watchdog-managed) ──────────────────────────────────────
  const connect = (): (() => void) =>
    options.transport.subscribe<T>(ingest, options.topic2 ? { topic2: options.topic2 } : undefined);

  const watchdogEnabled = options.watchdog?.enabled ?? true;
  let stopSubscription: () => void;
  let watchdog: SubscriptionWatchdog | null = null;
  if (watchdogEnabled) {
    watchdog = new SubscriptionWatchdog({
      connect,
      intervalMs: options.watchdog?.intervalMs,
      minIntervalMs: options.watchdog?.minIntervalMs,
    });
    watchdog.start();
    stopSubscription = () => watchdog?.stop();
  } else {
    const unsub = connect();
    stopSubscription = unsub;
  }

  return {
    feed,
    store,
    tier,
    publish: <U>(data: U, publishOptions?: PublishLike): Promise<void> => {
      if (!options.transport.publish) {
        return Promise.reject(new Error("transport does not support publish"));
      }
      return options.transport.publish<U>(data, publishOptions);
    },
    flush: () => persister.flush(),
    stop: () => {
      clearTimeout(armTimer);
      stopSubscription();
      feed.dispose();
      store.dispose();
      persister.flush();
      persister.dispose();
    },
  };
}

function toDecodeError(err: unknown): NotifyError {
  return new NotifyError("decode-failed", "toRecord threw", { cause: err });
}
