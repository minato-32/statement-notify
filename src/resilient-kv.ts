/** Hardened blob persistence over a {@link KvBackend} + host/browser/memory
 *  fallback. Adds single-in-flight serialization, per-write timeout, read-back
 *  verify, bounded retry, debounced coalescing, and flush on teardown — for
 *  key-value backends that silently swallow write failures. */

import type { KvBackend } from "./types.js";
import { NotifyError } from "./types.js";
import { hasDom, withTimeout } from "./util.js";

export interface ResilientKvOptions {
  backend: KvBackend;
  /** The single key this store owns. */
  key: string;
  /** Coalesce write bursts into one KV round-trip (default 400ms). */
  debounceMs?: number;
  /** Bound a single write so a hung host bridge can't pin the writer (default 5000ms). */
  timeoutMs?: number;
  /** Bounded retries for a failed/timed-out write (default 3). */
  maxRetries?: number;
  /** Read back after each write and retry on mismatch (default true). Surfaces
   *  the host KV's silently-swallowed set() failures. */
  verify?: boolean;
  /** Notified on a give-up (all retries exhausted). Never throws into callers. */
  onError?: (err: NotifyError) => void;
}

/** Persist a single string blob durably and reactively-safely. */
export class ResilientKvStore {
  private readonly backend: KvBackend;
  private readonly key: string;
  private readonly debounceMs: number;
  private readonly timeoutMs: number;
  private readonly maxRetries: number;
  private readonly verify: boolean;
  private readonly onError: ((err: NotifyError) => void) | undefined;

  private pending: string | null = null;
  private timer: ReturnType<typeof setTimeout> | null = null;
  private writing = false;
  private queued = false;
  private failures = 0;
  private disposed = false;
  private readonly onHide = (): void => {
    if (document.visibilityState === "hidden") this.flush();
  };
  private readonly onPageHide = (): void => this.flush();

  constructor(options: ResilientKvOptions) {
    this.backend = options.backend;
    this.key = options.key;
    this.debounceMs = options.debounceMs ?? 400;
    this.timeoutMs = options.timeoutMs ?? 5_000;
    this.maxRetries = options.maxRetries ?? 3;
    this.verify = options.verify ?? true;
    this.onError = options.onError;
    if (hasDom()) {
      document.addEventListener("visibilitychange", this.onHide);
      window.addEventListener("pagehide", this.onPageHide);
    }
  }

  /** Read the persisted blob. Time-bounded; returns null on absence/failure. */
  async load(): Promise<string | null> {
    try {
      return await withTimeout(this.backend.get(this.key), this.timeoutMs);
    } catch {
      return null;
    }
  }

  /** Schedule a debounced write of the latest value. */
  save(value: string): void {
    if (this.disposed) return;
    this.pending = value;
    if (this.timer) clearTimeout(this.timer);
    this.timer = setTimeout(() => {
      this.timer = null;
      void this.persist();
    }, this.debounceMs);
  }

  /** Cancel the debounce and persist the latest value immediately. */
  flush(): void {
    if (this.timer) {
      clearTimeout(this.timer);
      this.timer = null;
    }
    void this.persist();
  }

  private async persist(): Promise<void> {
    if (this.pending === null) return;
    // Serialize: at most one write in flight; a later request coalesces so
    // out-of-order completions can't overwrite a newer blob with a stale one.
    if (this.writing) {
      this.queued = true;
      return;
    }
    this.writing = true;
    const value = this.pending;
    try {
      await withTimeout(this.backend.set(this.key, value), this.timeoutMs);
      if (this.verify) {
        const readBack = await withTimeout(this.backend.get(this.key), this.timeoutMs);
        if (readBack !== value) {
          throw new NotifyError("kv-write-failed", "read-back verify mismatch");
        }
      }
      this.failures = 0;
      // Only clear pending if nothing newer arrived while we were writing.
      if (this.pending === value) this.pending = null;
    } catch (err) {
      if (this.failures < this.maxRetries) {
        this.failures += 1;
        this.queued = true; // bounded retry
      } else {
        this.failures = 0;
        this.onError?.(
          err instanceof NotifyError
            ? err
            : new NotifyError("kv-write-timeout", "persist failed", { cause: err }),
        );
      }
    } finally {
      this.writing = false;
      if (this.queued) {
        this.queued = false;
        void this.persist();
      }
    }
  }

  dispose(): void {
    this.disposed = true;
    if (this.timer) clearTimeout(this.timer);
    if (hasDom()) {
      document.removeEventListener("visibilitychange", this.onHide);
      window.removeEventListener("pagehide", this.onPageHide);
    }
  }
}

// ─── Backend fallback ────────────────────────────────────────────────────────

/** A `KvBackend` over the browser's `localStorage`, or `null` if unavailable
 *  (e.g. a sandboxed WebView that also blocks Web Storage). */
export function browserLocalStorageBackend(): KvBackend | null {
  if (!hasDom()) return null;
  let ls: Storage;
  try {
    ls = window.localStorage;
    const probe = "__sn_probe__";
    ls.setItem(probe, "1");
    ls.removeItem(probe);
  } catch {
    return null;
  }
  return {
    get: (k) => Promise.resolve(ls.getItem(k)),
    set: (k, v) => {
      ls.setItem(k, v);
      return Promise.resolve();
    },
    remove: (k) => {
      ls.removeItem(k);
      return Promise.resolve();
    },
    getJSON: <T>(k: string): Promise<T | null> => {
      const raw = ls.getItem(k);
      return Promise.resolve(raw === null ? null : (JSON.parse(raw) as T));
    },
    setJSON: (k, v) => {
      ls.setItem(k, JSON.stringify(v));
      return Promise.resolve();
    },
  };
}

/** A session-only in-memory `KvBackend` (last-resort fallback + test double). */
export function memoryKvBackend(): KvBackend {
  const map = new Map<string, string>();
  return {
    get: (k) => Promise.resolve(map.get(k) ?? null),
    set: (k, v) => {
      map.set(k, v);
      return Promise.resolve();
    },
    remove: (k) => {
      map.delete(k);
      return Promise.resolve();
    },
    getJSON: <T>(k: string): Promise<T | null> => {
      const raw = map.get(k);
      return Promise.resolve(raw === undefined ? null : (JSON.parse(raw) as T));
    },
    setJSON: (k, v) => {
      map.set(k, JSON.stringify(v));
      return Promise.resolve();
    },
  };
}

/**
 * Pick a persistence backend: the injected one (host KV) when present, else the
 * browser's localStorage, else session-only memory. This is the "survives
 * IndexedDB deletion" path — inject the host KV in a container; everywhere else
 * degrade gracefully instead of throwing.
 */
export function resolveKvBackend(injected?: KvBackend | null): {
  backend: KvBackend;
  tier: "host" | "browser" | "memory";
} {
  if (injected) return { backend: injected, tier: "host" };
  const browser = browserLocalStorageBackend();
  if (browser) return { backend: browser, tier: "browser" };
  return { backend: memoryKvBackend(), tier: "memory" };
}
