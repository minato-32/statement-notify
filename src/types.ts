/** Public types + the injectable adapter interfaces the core composes over:
 *  {@link KvBackend}, {@link NotifyTransport}, {@link PushSink}. Wire any
 *  platform (see `/adapters`) or a test double without touching the core. */

// ─── Records ────────────────────────────────────────────────────────────────

/** Relative importance — drives ordering (priority sort) and toast raising. */
export type NotifyPriority = "low" | "normal" | "high" | "urgent";

/** Numeric weight for a priority, high → large. Used by priority sorting. */
export const PRIORITY_WEIGHT: Record<NotifyPriority, number> = {
  low: 0,
  normal: 1,
  high: 2,
  urgent: 3,
};

/** One feed item. `P` is your decoded payload; engagement/surface fields are managed here. */
export interface NotifyRecord<P = unknown> {
  /** Stable primary key — the dedupe / idempotency key. */
  id: string;
  /** Event time (ms since epoch), used for ordering. */
  ts: number;
  /** The consumer's decoded statement payload. */
  payload: P;
  /** Optional grouping/filtering bucket (e.g. "trade", "system"). */
  category?: string;
  /** Optional importance (default treated as "normal"). */
  priority?: NotifyPriority;
  /** Optional short title, for surfaces that render one (bell/toast). */
  title?: string;
  /** Optional one-line body. */
  body?: string;
  /** Highlighted + counted toward the unread badge until read. */
  read?: boolean;
  /** Rendered on-screen at least once (does not affect the badge once seen). */
  seen?: boolean;
  /** Hidden from the feed surface (soft delete — the row is kept for joins). */
  dismissed?: boolean;
  /** In-app route to open on tap, or null when not actionable. */
  route?: string | null;
}

// ─── KV backend (persistence target) ────────────────────────────────────────

/** A string/JSON key-value store (shape matches the SDK's `LocalKvStore`). */
export interface KvBackend {
  get(key: string): Promise<string | null>;
  set(key: string, value: string): Promise<void>;
  remove(key: string): Promise<void>;
  getJSON<T>(key: string): Promise<T | null>;
  setJSON(key: string, value: unknown): Promise<void>;
}

// ─── Statement transport (data source) ──────────────────────────────────────

/** Metadata carried alongside a decoded statement payload. */
export interface StatementMeta {
  /** blake2b channel hash (hex), when the statement used a channel. */
  channelHex?: string;
  /** Routing topics attached to the statement. */
  topics?: string[];
}

/** Options for a publish call. */
export interface PublishLike {
  /** Last-write-wins channel key. */
  channel?: string;
  /** Secondary topic filter. */
  topic2?: string;
  /** Time-to-live override (seconds). */
  ttlSeconds?: number;
}

/** Injectable message source. `subscribe` delivers already-decoded payloads (adapter in `/adapters`). */
export interface NotifyTransport {
  subscribe<T>(
    onData: (data: T, meta: StatementMeta) => void,
    options?: { topic2?: string },
  ): () => void;
  /** Optional — enables the publish helper on the notifier. */
  publish?<T>(data: T, options?: PublishLike): Promise<void>;
  /** Optional — used by the watchdog to gate re-subscribes. */
  isConnected?(): boolean;
}

// ─── Push side-channel (optional OS notification) ───────────────────────────

/** A minimal OS-push payload the package can map onto a host push manager. */
export interface PushInput {
  title: string;
  body?: string;
  /** Deep-link the host opens on tap. */
  route?: string;
}

/** Injectable OS-push side-channel. Optional + best-effort; when absent, OS push is skipped and the feed still works. */
export interface PushSink {
  push(input: PushInput): Promise<unknown>;
  cancel?(id: unknown): Promise<void>;
}

// ─── Errors ─────────────────────────────────────────────────────────────────

/** Typed error kinds surfaced by the package (never thrown into React render). */
export type NotifyErrorKind =
  | "kv-write-timeout"
  | "kv-write-failed"
  | "kv-read-failed"
  | "decode-failed"
  | "transport-lost";

export class NotifyError extends Error {
  readonly kind: NotifyErrorKind;
  constructor(kind: NotifyErrorKind, message: string, options?: ErrorOptions) {
    super(message, options);
    this.name = "NotifyError";
    this.kind = kind;
  }
}
