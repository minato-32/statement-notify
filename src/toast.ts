/** A framework-agnostic toast store: transient messages with a loading→success/
 *  error `promise()` lifecycle, a max-visible cap, and auto-dismiss. Reactive via
 *  subscribe/getSnapshot. Independent of the feed. */

export type ToastKind = "info" | "success" | "error" | "loading";

export interface Toast {
  id: string;
  kind: ToastKind;
  title: string;
  message?: string;
  createdAt: number;
  /** Auto-dismiss after this many ms; `loading` toasts never auto-dismiss. */
  duration?: number;
}

export type ToastInput = Omit<Toast, "id" | "createdAt">;

export interface PromiseMessages<T> {
  loading: string;
  success: string | ((value: T) => string);
  error: string | ((error: unknown) => string);
}

export interface ToastStore {
  subscribe(onChange: () => void): () => void;
  getSnapshot(): Toast[];
  add(input: ToastInput): string;
  update(id: string, patch: Partial<ToastInput>): void;
  dismiss(id: string): void;
  clear(): void;
  /** Drive a toast through a promise's lifecycle; resolves/rejects as the promise does. */
  promise<T>(promise: Promise<T>, messages: PromiseMessages<T>): Promise<T>;
  dispose(): void;
}

export interface CreateToastStoreOptions {
  /** Maximum simultaneously-visible toasts; oldest dropped beyond this (default 4). */
  max?: number;
  /** Default auto-dismiss for non-loading toasts, ms (default 5000). */
  defaultDuration?: number;
}

export function createToastStore(options: CreateToastStoreOptions = {}): ToastStore {
  const max = options.max ?? 4;
  const defaultDuration = options.defaultDuration ?? 5_000;

  let toasts: Toast[] = [];
  const listeners = new Set<() => void>();
  const timers = new Map<string, ReturnType<typeof setTimeout>>();
  let counter = 0;

  const emit = (): void => {
    for (const cb of listeners) cb();
  };

  const clearTimer = (id: string): void => {
    const t = timers.get(id);
    if (t) {
      clearTimeout(t);
      timers.delete(id);
    }
  };

  const scheduleDismiss = (id: string, duration: number): void => {
    clearTimer(id);
    if (duration > 0) {
      timers.set(
        id,
        setTimeout(() => {
          store.dismiss(id);
        }, duration),
      );
    }
  };

  const store: ToastStore = {
    subscribe: (onChange) => {
      listeners.add(onChange);
      return () => {
        listeners.delete(onChange);
      };
    },
    getSnapshot: () => toasts,
    add: (input) => {
      counter += 1;
      const id = `t${counter.toString(36)}`;
      const toast: Toast = { ...input, id, createdAt: Date.now() };
      toasts = [...toasts, toast].slice(-max);
      emit();
      const duration = input.duration ?? (input.kind === "loading" ? 0 : defaultDuration);
      scheduleDismiss(id, duration);
      return id;
    },
    update: (id, patch) => {
      let found = false;
      toasts = toasts.map((t) => {
        if (t.id !== id) return t;
        found = true;
        return { ...t, ...patch };
      });
      if (!found) return;
      emit();
      const updated = toasts.find((t) => t.id === id);
      if (updated) {
        const duration = updated.duration ?? (updated.kind === "loading" ? 0 : defaultDuration);
        scheduleDismiss(id, duration);
      }
    },
    dismiss: (id) => {
      clearTimer(id);
      const next = toasts.filter((t) => t.id !== id);
      if (next.length === toasts.length) return;
      toasts = next;
      emit();
    },
    clear: () => {
      for (const id of timers.keys()) clearTimer(id);
      if (toasts.length === 0) return;
      toasts = [];
      emit();
    },
    promise: <T>(promise: Promise<T>, messages: PromiseMessages<T>): Promise<T> => {
      const id = store.add({ kind: "loading", title: messages.loading });
      return promise.then(
        (value) => {
          store.update(id, {
            kind: "success",
            title:
              typeof messages.success === "function"
                ? messages.success(value)
                : messages.success,
          });
          return value;
        },
        (error: unknown) => {
          store.update(id, {
            kind: "error",
            title:
              typeof messages.error === "function" ? messages.error(error) : messages.error,
          });
          throw error;
        },
      );
    },
    dispose: () => {
      for (const id of timers.keys()) clearTimer(id);
      listeners.clear();
      toasts = [];
    },
  };

  return store;
}
