/**
 * A cross-platform, reactive in-app notification store: a durable, deduped feed
 * with read/unread state over an injected message source + storage, with
 * host-KV → browser → memory persistence fallback. Core here; React bindings at
 * `/react`, platform adapters at `/adapters`, test doubles at `/testing`.
 */

export { createStatementNotifier } from "./notifier.js";
export type {
  DurabilityTier,
  Notifier,
  NotifierOptions,
} from "./notifier.js";

export { NotificationFeed } from "./notification-feed.js";
export type { FeedView } from "./notification-feed.js";

export { PersistentRecordStore } from "./record-store.js";
export type { RecordStoreOptions } from "./record-store.js";

export {
  browserLocalStorageBackend,
  memoryKvBackend,
  ResilientKvStore,
  resolveKvBackend,
} from "./resilient-kv.js";
export type { ResilientKvOptions } from "./resilient-kv.js";

export { SubscriptionWatchdog } from "./watchdog.js";
export type { WatchdogOptions } from "./watchdog.js";

export {
  categoriesOf,
  groupBy,
  groupByDay,
  queryRecords,
} from "./query.js";
export type { FeedQuery, Group, TextOf } from "./query.js";

export {
  createPreferences,
  isDndActive,
  isSuppressed,
} from "./preferences.js";
export type {
  CreatePreferencesOptions,
  NotificationPreferences,
  PreferencesStore,
} from "./preferences.js";

export { createToastStore } from "./toast.js";
export type {
  CreateToastStoreOptions,
  PromiseMessages,
  Toast,
  ToastInput,
  ToastKind,
  ToastStore,
} from "./toast.js";

export { NotifyError, PRIORITY_WEIGHT } from "./types.js";
export type {
  KvBackend,
  NotifyErrorKind,
  NotifyPriority,
  NotifyRecord,
  NotifyTransport,
  PublishLike,
  PushInput,
  PushSink,
  StatementMeta,
} from "./types.js";
