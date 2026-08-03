import {
  categoriesOf,
  groupByDay,
  type FeedQuery,
  type NotifyPriority,
  type NotifyRecord,
} from "@minato-32/statement-notify";
import {
  useFeedQuery,
  useNotifications,
  usePreferences,
  useToasts,
  useUnreadCount,
} from "@minato-32/statement-notify/react";
import { useMemo, useState } from "react";

import {
  type DemoNotifier,
  emit,
  emitDuplicate,
  prefs,
  toasts,
  type Wire,
} from "./store.js";

const CATEGORIES = ["trade", "system", "social"];
const PRIORITIES: NotifyPriority[] = ["low", "normal", "high", "urgent"];

export function App({ notifier }: { notifier: DemoNotifier }): JSX.Element {
  const feed = notifier.feed;
  const unread = useUnreadCount(feed);

  return (
    <main className="app">
      <header className="app-head">
        <h1>@minato-32/statement-notify</h1>
        <div className="head-right">
          <span className="tier">persistence: <b>{notifier.tier}</b></span>
          <span className="bell">🔔 {unread > 0 && <span className="badge">{unread}</span>}</span>
        </div>
      </header>

      <p className="hint">
        Drive real statements with the buttons below. Everything persists to
        localStorage — <b>reload the page</b> and items + read-state survive.
      </p>

      <section className="grid">
        <Emitters />
        <Preferences />
        <ToastDemo />
      </section>

      <Feed feed={feed} />
      <ToastRegion />
    </main>
  );
}

function Emitters(): JSX.Element {
  return (
    <div className="card">
      <h3>Emit statements</h3>
      {CATEGORIES.map((cat) => (
        <div key={cat} className="row">
          <span className="cat-label">{cat}</span>
          {PRIORITIES.map((p) => (
            <button key={p} className={`pri pri-${p}`} onClick={() => emit(cat, p)}>
              {p}
            </button>
          ))}
        </div>
      ))}
      <button className="ghost" onClick={emitDuplicate}>
        Emit duplicate id (dedupe test)
      </button>
    </div>
  );
}

function Preferences(): JSX.Element {
  const p = usePreferences(prefs);
  const dndOn = p.dnd !== undefined;
  return (
    <div className="card">
      <h3>Preferences (gate push, not the feed)</h3>
      <div className="muted-list">
        {CATEGORIES.map((cat) => {
          const muted = p.mutedCategories.includes(cat);
          return (
            <label key={cat} className="check">
              <input
                type="checkbox"
                checked={muted}
                onChange={() => (muted ? prefs.unmuteCategory(cat) : prefs.muteCategory(cat))}
              />
              mute {cat}
            </label>
          );
        })}
      </div>
      <label className="check">
        <input
          type="checkbox"
          checked={dndOn}
          onChange={(e) => prefs.set({ dnd: e.target.checked ? { start: "00:00", end: "23:59" } : undefined })}
        />
        do-not-disturb (all day, for demo)
      </label>
      <p className="tiny">Muted / DND → no 📢 push toast. In-app feed still records.</p>
    </div>
  );
}

function ToastDemo(): JSX.Element {
  return (
    <div className="card">
      <h3>Toasts (async lifecycle)</h3>
      <button onClick={() => void toasts.promise(wait(1200), { loading: "Submitting…", success: "Submitted ✓", error: "Failed" })}>
        promise → success
      </button>
      <button onClick={() => void toasts.promise(fail(1200), { loading: "Submitting…", success: "ok", error: (e) => `Failed: ${String(e)}` }).catch(() => undefined)}>
        promise → error
      </button>
      <button className="ghost" onClick={() => toasts.add({ kind: "info", title: "Just an info toast" })}>
        info toast
      </button>
    </div>
  );
}

function Feed({ feed }: { feed: DemoNotifier["feed"] }): JSX.Element {
  const { items, unreadCount } = useNotifications(feed);
  const [search, setSearch] = useState("");
  const [unreadOnly, setUnreadOnly] = useState(false);
  const [category, setCategory] = useState("");
  const [sort, setSort] = useState<"recent" | "priority">("recent");

  const query = useMemo<FeedQuery>(
    () => ({ search, unreadOnly, sort, ...(category ? { category } : {}) }),
    [search, unreadOnly, sort, category],
  );
  const visible = useFeedQuery<Wire>(feed, query);
  const groups = groupByDay(visible);
  const cats = categoriesOf(items);

  return (
    <section className="feed card">
      <div className="feed-head">
        <h3>Feed ({visible.length}) · unread {unreadCount}</h3>
        <div className="controls">
          <input className="search" type="search" placeholder="Search…" value={search} onChange={(e) => setSearch(e.target.value)} />
          <select value={category} onChange={(e) => setCategory(e.target.value)}>
            <option value="">all categories</option>
            {cats.map((c) => (
              <option key={c} value={c}>{c}</option>
            ))}
          </select>
          <select value={sort} onChange={(e) => setSort(e.target.value as "recent" | "priority")}>
            <option value="recent">recent</option>
            <option value="priority">priority</option>
          </select>
          <label className="check">
            <input type="checkbox" checked={unreadOnly} onChange={(e) => setUnreadOnly(e.target.checked)} />
            unread only
          </label>
          <button onClick={() => feed.markAllRead()} disabled={unreadCount === 0}>mark all read</button>
          <button className="ghost" onClick={() => feed.clearAll()} disabled={visible.length === 0}>clear all</button>
        </div>
      </div>

      {visible.length === 0 ? (
        <p className="empty">No notifications. Emit some above.</p>
      ) : (
        groups.map((group) => (
          <div key={group.key} className="group">
            <h4 className="group-label">{group.label}</h4>
            {group.items.map((item) => (
              <Item key={item.id} item={item} feed={feed} />
            ))}
          </div>
        ))
      )}
    </section>
  );
}

function Item({ item, feed }: { item: NotifyRecord<Wire>; feed: DemoNotifier["feed"] }): JSX.Element {
  return (
    <div className={`item pri-border-${item.priority ?? "normal"}`} data-read={item.read === true}>
      <div className="item-main">
        <div className="item-title">
          {item.read !== true && <span className="dot" />}
          {item.title}
          <span className={`chip chip-${item.category}`}>{item.category}</span>
          <span className="chip chip-pri">{item.priority}</span>
        </div>
        <div className="item-body">{item.body}</div>
      </div>
      <div className="item-actions">
        {item.read !== true && <button onClick={() => feed.markRead(item.id)}>read</button>}
        <button className="ghost" onClick={() => feed.dismiss(item.id)}>dismiss</button>
      </div>
    </div>
  );
}

function ToastRegion(): JSX.Element {
  const active = useToasts(toasts);
  return (
    <div className="toast-region" role="status" aria-live="polite">
      {active.map((t) => (
        <div key={t.id} className={`toast toast-${t.kind}`}>
          <div>
            <b>{t.title}</b>
            {t.message && <div className="toast-msg">{t.message}</div>}
          </div>
          <button className="toast-x" onClick={() => toasts.dismiss(t.id)}>×</button>
        </div>
      ))}
    </div>
  );
}

const wait = (ms: number): Promise<void> => new Promise((r) => setTimeout(r, ms));
const fail = (ms: number): Promise<never> =>
  new Promise((_, reject) => setTimeout(() => reject(new Error("network")), ms));
