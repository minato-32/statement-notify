/** Re-subscribe watchdog for the silent-deaf failure mode: a receive-only
 *  subscription that stays "open" but stops delivering (transport disposed/
 *  rebound with no error). Forces a fresh subscribe on visibility / focus / a
 *  slow interval (deduped by id on replay); a min-interval floor collapses
 *  simultaneous triggers into one reconnect. */

import { hasDom } from "./util.js";

export interface WatchdogOptions {
  /** (Re)establish the subscription and return its unsubscribe. */
  connect: () => () => void;
  /** Backstop re-subscribe cadence in ms (default 120_000). */
  intervalMs?: number;
  /** Floor between re-subscribes in ms so visibility+focus+interval collapse to one (default 10_000). */
  minIntervalMs?: number;
}

export class SubscriptionWatchdog {
  private readonly connect: () => () => void;
  private readonly intervalMs: number;
  private readonly minIntervalMs: number;

  private unsub: (() => void) | null = null;
  private interval: ReturnType<typeof setInterval> | null = null;
  private lastConnectAt = 0;
  private started = false;

  private readonly onRefresh = (): void => {
    if (!this.started) return;
    if (hasDom() && document.visibilityState === "hidden") return;
    if (Date.now() - this.lastConnectAt < this.minIntervalMs) return;
    this.reconnect();
  };

  constructor(options: WatchdogOptions) {
    this.connect = options.connect;
    this.intervalMs = options.intervalMs ?? 120_000;
    this.minIntervalMs = options.minIntervalMs ?? 10_000;
  }

  start(): void {
    if (this.started) return;
    this.started = true;
    this.reconnect();
    this.interval = setInterval(this.onRefresh, this.intervalMs);
    if (hasDom()) {
      document.addEventListener("visibilitychange", this.onRefresh);
      window.addEventListener("focus", this.onRefresh);
    }
  }

  stop(): void {
    this.started = false;
    if (this.interval !== null) {
      clearInterval(this.interval);
      this.interval = null;
    }
    if (hasDom()) {
      document.removeEventListener("visibilitychange", this.onRefresh);
      window.removeEventListener("focus", this.onRefresh);
    }
    this.unsub?.();
    this.unsub = null;
  }

  private reconnect(): void {
    this.lastConnectAt = Date.now();
    this.unsub?.();
    this.unsub = null;
    try {
      this.unsub = this.connect();
    } catch {
      // A failed (re)subscribe is retried on the next trigger; never throw.
      this.unsub = null;
    }
  }
}
