/** React bindings — reactive hooks only (the package ships data logic, not UI).
 *  All are `useSyncExternalStore` over the stores' stable subscribe/getSnapshot
 *  (tearing-free, SSR-safe). `react` is an optional peer. */

import { useMemo, useSyncExternalStore } from "react";

import type { FeedView, NotificationFeed } from "./notification-feed.js";
import type { NotificationPreferences, PreferencesStore } from "./preferences.js";
import { type FeedQuery, queryRecords, type TextOf } from "./query.js";
import type { PersistentRecordStore } from "./record-store.js";
import type { Toast, ToastStore } from "./toast.js";
import type { NotifyRecord } from "./types.js";

/** Subscribe to the full notification feed view (items + unread count). */
export function useNotifications<P>(feed: NotificationFeed<P>): FeedView<P> {
  return useSyncExternalStore(feed.subscribe, feed.getSnapshot, feed.getSnapshot);
}

/** Subscribe to just the unread badge count. */
export function useUnreadCount<P>(feed: NotificationFeed<P>): number {
  return useSyncExternalStore(
    feed.subscribe,
    () => feed.getSnapshot().unreadCount,
    () => feed.getSnapshot().unreadCount,
  );
}

/** Subscribe to the raw record set (advanced — most UIs want `useNotifications`). */
export function useRecords<P>(store: PersistentRecordStore<P>): NotifyRecord<P>[] {
  return useSyncExternalStore(store.subscribe, store.getSnapshot, store.getSnapshot);
}

/**
 * A filtered / searched / paginated view of the feed. `query` is applied via
 * {@link queryRecords}; memoize `query` (or pass a stable object) to avoid
 * recomputing every render.
 */
export function useFeedQuery<P>(
  feed: NotificationFeed<P>,
  query: FeedQuery,
  textOf?: TextOf<P>,
): NotifyRecord<P>[] {
  const { items } = useNotifications(feed);
  return useMemo(() => queryRecords(items, query, textOf), [items, query, textOf]);
}

/** Subscribe to the reactive preferences. */
export function usePreferences(store: PreferencesStore): NotificationPreferences {
  return useSyncExternalStore(store.subscribe, store.getSnapshot, store.getSnapshot);
}

/** Subscribe to the live toast list for a store. */
export function useToasts(store: ToastStore): Toast[] {
  return useSyncExternalStore(store.subscribe, store.getSnapshot, store.getSnapshot);
}
