/** An accumulating, reactive, persisted record store, keyed by a stable id.
 *  Holds the whole (bounded) set in memory for a synchronous
 *  `useSyncExternalStore` read; hydrates from the persister on boot and mirrors
 *  every change back to it. */

import type { ResilientKvStore } from "./resilient-kv.js";
import { decodeEnvelope, encodeEnvelope } from "./serialize.js";
import type { NotifyRecord } from "./types.js";

export interface RecordStoreOptions {
  persister: ResilientKvStore;
  /** Consumer record-schema version; a mismatch on load discards persisted data. */
  schemaVersion: number;
  /** Max records retained; the oldest by `ts` are evicted beyond this (default 500). */
  maxRecords?: number;
}

const DEFAULT_MAX_RECORDS = 500;

export class PersistentRecordStore<P = unknown> {
  private readonly persister: ResilientKvStore;
  private readonly schemaVersion: number;
  private readonly maxRecords: number;

  private readonly rows = new Map<string, NotifyRecord<P>>();
  /** Referentially-stable snapshot — a new array only when data changes. */
  private snap: NotifyRecord<P>[] = [];
  private readonly listeners = new Set<() => void>();

  constructor(options: RecordStoreOptions) {
    this.persister = options.persister;
    this.schemaVersion = options.schemaVersion;
    this.maxRecords = options.maxRecords ?? DEFAULT_MAX_RECORDS;
  }

  // ─── Reactive read ─────────────────────────────────────────────────────────

  readonly subscribe = (onChange: () => void): (() => void) => {
    this.listeners.add(onChange);
    return () => {
      this.listeners.delete(onChange);
    };
  };

  readonly getSnapshot = (): NotifyRecord<P>[] => this.snap;

  // ─── Lifecycle ─────────────────────────────────────────────────────────────

  /** Load persisted records. Best-effort; a version mismatch starts empty. */
  async hydrate(): Promise<void> {
    const raw = await this.persister.load();
    if (raw === null) return;
    const records = decodeEnvelope<NotifyRecord<P>[]>(raw, this.schemaVersion);
    if (!Array.isArray(records)) return;
    for (const record of records) {
      // Guard against a corrupt/tampered blob: skip anything without a stable id
      // and a numeric ts (a NaN ts would break ordering downstream).
      if (
        record !== null &&
        typeof record.id === "string" &&
        typeof record.ts === "number" &&
        Number.isFinite(record.ts)
      ) {
        this.rows.set(record.id, record);
      }
    }
    this.rebuild();
  }

  dispose(): void {
    this.listeners.clear();
  }

  // ─── Writes ────────────────────────────────────────────────────────────────

  /** Insert if new. Returns `true` when the row was new (for freshness gating),
   *  `false` on a duplicate id (idempotent — safe under backlog replay). */
  add(row: NotifyRecord<P>): boolean {
    if (this.rows.has(row.id)) return false;
    this.rows.set(row.id, row);
    this.changed();
    return true;
  }

  /** Upsert (last-write-wins by caller). */
  put(row: NotifyRecord<P>): void {
    this.rows.set(row.id, row);
    this.changed();
  }

  get(id: string): NotifyRecord<P> | undefined {
    return this.rows.get(id);
  }

  getAll(): NotifyRecord<P>[] {
    return this.snap;
  }

  update(id: string, changes: Partial<NotifyRecord<P>>): void {
    const cur = this.rows.get(id);
    if (!cur) return;
    this.rows.set(id, { ...cur, ...changes });
    this.changed();
  }

  modifyMany(ids: string[], changes: Partial<NotifyRecord<P>>): void {
    let touched = false;
    for (const id of ids) {
      const cur = this.rows.get(id);
      if (cur) {
        this.rows.set(id, { ...cur, ...changes });
        touched = true;
      }
    }
    if (touched) this.changed();
  }

  // ─── Internal ──────────────────────────────────────────────────────────────

  private changed(): void {
    this.evict();
    this.rebuild();
    this.notify();
    this.persist();
  }

  /** Drop the oldest records (by `ts`) once over capacity. */
  private evict(): void {
    const over = this.rows.size - this.maxRecords;
    if (over <= 0) return;
    const oldest = Array.from(this.rows.values())
      .sort((a, b) => a.ts - b.ts)
      .slice(0, over);
    for (const record of oldest) this.rows.delete(record.id);
  }

  private rebuild(): void {
    this.snap = Array.from(this.rows.values());
  }

  private notify(): void {
    for (const cb of this.listeners) cb();
  }

  private persist(): void {
    this.persister.save(encodeEnvelope(this.snap, this.schemaVersion));
  }
}
