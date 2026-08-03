/** Pure, non-mutating selectors over feed records: filter, search, sort,
 *  paginate, group. */

import type { NotifyPriority, NotifyRecord } from "./types.js";
import { PRIORITY_WEIGHT } from "./types.js";

/** How to render a record as searchable/plain text. Defaults to title/body then
 *  a JSON dump of the payload. */
export type TextOf<P> = (record: NotifyRecord<P>) => string;

function defaultText<P>(record: NotifyRecord<P>): string {
  return (
    record.title ??
    record.body ??
    (typeof record.payload === "string" ? record.payload : JSON.stringify(record.payload))
  );
}

function priorityOf<P>(record: NotifyRecord<P>): number {
  return PRIORITY_WEIGHT[record.priority ?? "normal"];
}

export interface FeedQuery {
  /** Keep only these categories (string or list). */
  category?: string | string[];
  /** Keep only unread records. */
  unreadOnly?: boolean;
  /** Case-insensitive substring match against the record text. */
  search?: string;
  /** Keep only records at or above this priority. */
  minPriority?: NotifyPriority;
  /** Ordering — newest first ("recent", default) or priority then recency. */
  sort?: "recent" | "priority";
  /** Windowing. */
  limit?: number;
  offset?: number;
}

/** Apply a {@link FeedQuery} to a list of records. */
export function queryRecords<P>(
  items: NotifyRecord<P>[],
  query: FeedQuery = {},
  textOf: TextOf<P> = defaultText,
): NotifyRecord<P>[] {
  const categories =
    query.category === undefined
      ? null
      : new Set(Array.isArray(query.category) ? query.category : [query.category]);
  const needle = query.search?.trim().toLowerCase();
  const minWeight = query.minPriority ? PRIORITY_WEIGHT[query.minPriority] : null;

  let out = items.filter((r) => {
    if (categories && !categories.has(r.category ?? "")) return false;
    if (query.unreadOnly && r.read === true) return false;
    if (minWeight !== null && priorityOf(r) < minWeight) return false;
    if (needle && !textOf(r).toLowerCase().includes(needle)) return false;
    return true;
  });

  out =
    query.sort === "priority"
      ? out.sort((a, b) => priorityOf(b) - priorityOf(a) || b.ts - a.ts)
      : out.sort((a, b) => b.ts - a.ts);

  const offset = query.offset ?? 0;
  const end = query.limit === undefined ? undefined : offset + query.limit;
  return offset === 0 && end === undefined ? out : out.slice(offset, end);
}

export interface Group<P> {
  key: string;
  label: string;
  items: NotifyRecord<P>[];
}

/** Group records by an arbitrary key, preserving first-seen order. */
export function groupBy<P>(
  items: NotifyRecord<P>[],
  keyOf: (record: NotifyRecord<P>) => string,
  labelOf: (key: string) => string = (k) => k,
): Group<P>[] {
  const map = new Map<string, NotifyRecord<P>[]>();
  for (const item of items) {
    const key = keyOf(item);
    const bucket = map.get(key);
    if (bucket) bucket.push(item);
    else map.set(key, [item]);
  }
  return Array.from(map, ([key, groupItems]) => ({ key, label: labelOf(key), items: groupItems }));
}

const DAY_MS = 86_400_000;

/** Group records into Today / Yesterday / Earlier buckets by timestamp. */
export function groupByDay<P>(items: NotifyRecord<P>[], now: number = Date.now()): Group<P>[] {
  const startOfToday = new Date(now);
  startOfToday.setHours(0, 0, 0, 0);
  const todayStart = startOfToday.getTime();
  const keyOf = (r: NotifyRecord<P>): string => {
    if (r.ts >= todayStart) return "today";
    if (r.ts >= todayStart - DAY_MS) return "yesterday";
    return "earlier";
  };
  const labels: Record<string, string> = {
    today: "Today",
    yesterday: "Yesterday",
    earlier: "Earlier",
  };
  return groupBy(items, keyOf, (k) => labels[k] ?? k);
}

/** Distinct categories present in a record list (for filter tabs). */
export function categoriesOf<P>(items: NotifyRecord<P>[]): string[] {
  const set = new Set<string>();
  for (const r of items) if (r.category) set.add(r.category);
  return Array.from(set).sort();
}
