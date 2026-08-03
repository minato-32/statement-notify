/** Reactive, persisted notification preferences: muted categories + a
 *  do-not-disturb window. Gates only proactive surfaces (OS push / toasts),
 *  never the in-app feed. */

import type { KvBackend, NotifyRecord } from "./types.js";

export interface NotificationPreferences {
  /** Categories whose records never raise a push/toast. */
  mutedCategories: string[];
  /** Local-time quiet window "HH:MM"–"HH:MM"; wraps past midnight if start > end. */
  dnd?: { start: string; end: string };
  /** Whether sound/vibration surfaces may fire (UI honors this). */
  soundEnabled: boolean;
}

const DEFAULTS: NotificationPreferences = {
  mutedCategories: [],
  soundEnabled: true,
};

export interface PreferencesStore {
  subscribe(onChange: () => void): () => void;
  getSnapshot(): NotificationPreferences;
  set(patch: Partial<NotificationPreferences>): void;
  muteCategory(category: string): void;
  unmuteCategory(category: string): void;
  /** Load persisted preferences (call once at startup). */
  hydrate(): Promise<void>;
}

export interface CreatePreferencesOptions {
  /** Persistence backend (host KV). Omit → in-memory only. */
  kv?: KvBackend | null;
  /** Namespace for the persisted key. */
  name?: string;
  /** Initial values (merged over built-in defaults). */
  defaults?: Partial<NotificationPreferences>;
}

/** Create a reactive, optionally-persisted preferences store. */
export function createPreferences(options: CreatePreferencesOptions = {}): PreferencesStore {
  const key = `statement-notify:prefs:${options.name ?? "default"}`;
  let prefs: NotificationPreferences = { ...DEFAULTS, ...options.defaults };
  const listeners = new Set<() => void>();

  const emit = (): void => {
    for (const cb of listeners) cb();
    if (options.kv) void options.kv.setJSON(key, prefs).catch(() => undefined);
  };

  return {
    subscribe: (onChange) => {
      listeners.add(onChange);
      return () => {
        listeners.delete(onChange);
      };
    },
    getSnapshot: () => prefs,
    set: (patch) => {
      prefs = { ...prefs, ...patch };
      emit();
    },
    muteCategory: (category) => {
      if (prefs.mutedCategories.includes(category)) return;
      prefs = { ...prefs, mutedCategories: [...prefs.mutedCategories, category] };
      emit();
    },
    unmuteCategory: (category) => {
      if (!prefs.mutedCategories.includes(category)) return;
      prefs = {
        ...prefs,
        mutedCategories: prefs.mutedCategories.filter((c) => c !== category),
      };
      emit();
    },
    hydrate: async () => {
      if (!options.kv) return;
      const stored = await options.kv.getJSON<NotificationPreferences>(key).catch(() => null);
      if (stored) {
        prefs = { ...prefs, ...stored };
        for (const cb of listeners) cb();
      }
    },
  };
}

/** Parse "HH:MM" to minutes-since-midnight, or null if malformed. */
function parseHHMM(value: string): number | null {
  const match = /^(\d{1,2}):(\d{2})$/.exec(value);
  if (!match) return null;
  const h = Number(match[1]);
  const m = Number(match[2]);
  if (h > 23 || m > 59) return null;
  return h * 60 + m;
}

/** Whether the do-not-disturb window is active at `now` (default: current time). */
export function isDndActive(prefs: NotificationPreferences, now: Date = new Date()): boolean {
  if (!prefs.dnd) return false;
  const start = parseHHMM(prefs.dnd.start);
  const end = parseHHMM(prefs.dnd.end);
  if (start === null || end === null) return false;
  const cur = now.getHours() * 60 + now.getMinutes();
  // Overnight window (e.g. 22:00–07:00) wraps past midnight.
  return start <= end ? cur >= start && cur < end : cur >= start || cur < end;
}

/**
 * Whether a record's proactive surfaces (push/toast) should be suppressed —
 * its category is muted, or a DND window is active. Never affects the in-app feed.
 */
export function isSuppressed<P>(
  record: NotifyRecord<P>,
  prefs: NotificationPreferences,
  now: Date = new Date(),
): boolean {
  if (record.category !== undefined && prefs.mutedCategories.includes(record.category)) {
    return true;
  }
  return isDndActive(prefs, now);
}
