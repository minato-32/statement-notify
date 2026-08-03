/** The in-app notification surface: a derived reactive view over the record
 *  store, adding engagement state (seen / read / dismissed) and a badge count.
 *
 *  Engagement is stored as fields on the records themselves — there is no second
 *  store — so the same data drives the bell, a toast, and a full center, and the
 *  unread count is consistent everywhere and across reloads. */

import type { PersistentRecordStore } from "./record-store.js";
import type { NotifyRecord } from "./types.js";

/** A referentially-stable snapshot of the feed for `useSyncExternalStore`. */
export interface FeedView<P = unknown> {
  /** Non-dismissed records, newest first. */
  items: NotifyRecord<P>[];
  /** Count of non-dismissed, unread records (the badge). */
  unreadCount: number;
}

const EMPTY_VIEW: FeedView = { items: [], unreadCount: 0 };

export class NotificationFeed<P = unknown> {
  private readonly store: PersistentRecordStore<P>;
  private readonly listeners = new Set<() => void>();
  private readonly unsubStore: () => void;
  private view: FeedView<P> = EMPTY_VIEW as FeedView<P>;

  constructor(store: PersistentRecordStore<P>) {
    this.store = store;
    this.view = this.derive();
    this.unsubStore = store.subscribe(() => {
      this.view = this.derive();
      for (const cb of this.listeners) cb();
    });
  }

  // ─── Reactive read ─────────────────────────────────────────────────────────

  readonly subscribe = (onChange: () => void): (() => void) => {
    this.listeners.add(onChange);
    return () => {
      this.listeners.delete(onChange);
    };
  };

  readonly getSnapshot = (): FeedView<P> => this.view;

  // ─── Engagement actions ────────────────────────────────────────────────────

  /** Mark a record as rendered (does not clear the unread badge). */
  markSeen(id: string): void {
    const cur = this.store.get(id);
    if (cur && cur.seen !== true) this.store.update(id, { seen: true });
  }

  /** Mark a single record read (clears it from the unread count). */
  markRead(id: string): void {
    const cur = this.store.get(id);
    if (cur && cur.read !== true) this.store.update(id, { read: true });
  }

  /** Mark every currently-visible record read. */
  markAllRead(): void {
    const ids = this.view.items.filter((r) => r.read !== true).map((r) => r.id);
    if (ids.length > 0) this.store.modifyMany(ids, { read: true });
  }

  /** Hide one record from the feed (soft delete). */
  dismiss(id: string): void {
    const cur = this.store.get(id);
    if (cur && cur.dismissed !== true) this.store.update(id, { dismissed: true });
  }

  /** Hide every currently-visible record from the feed. */
  clearAll(): void {
    const ids = this.view.items.map((r) => r.id);
    if (ids.length > 0) this.store.modifyMany(ids, { dismissed: true });
  }

  dispose(): void {
    this.unsubStore();
    this.listeners.clear();
  }

  private derive(): FeedView<P> {
    const items = this.store
      .getAll()
      .filter((r) => r.dismissed !== true)
      .sort((a, b) => b.ts - a.ts);
    let unreadCount = 0;
    for (const r of items) if (r.read !== true) unreadCount += 1;
    return { items, unreadCount };
  }
}
