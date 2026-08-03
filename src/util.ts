/** Small dependency-free helpers shared across modules. */

/** Reject a promise if it does not settle within `ms`. Used to bound host IPC
 *  calls so a disposed/hung host bridge can never pin an operation forever. */
export function withTimeout<T>(p: Promise<T>, ms: number): Promise<T> {
  return new Promise<T>((resolve, reject) => {
    const timer = setTimeout(() => reject(new Error(`timed out after ${ms}ms`)), ms);
    p.then(
      (v) => {
        clearTimeout(timer);
        resolve(v);
      },
      (e: unknown) => {
        clearTimeout(timer);
        reject(e instanceof Error ? e : new Error(String(e)));
      },
    );
  });
}

/** `true` when running in a DOM environment (guards SSR / Node import-safety). */
export function hasDom(): boolean {
  return typeof window !== "undefined" && typeof document !== "undefined";
}

/** Base64-encode bytes (small payloads only — statements are ≤512 bytes). */
export function u8ToBase64(bytes: Uint8Array): string {
  let s = "";
  for (const byte of bytes) s += String.fromCharCode(byte);
  return btoa(s);
}

/** Decode a base64 string back into bytes. */
export function base64ToU8(b64: string): Uint8Array {
  const bin = atob(b64);
  const out = new Uint8Array(bin.length);
  for (let i = 0; i < bin.length; i++) out[i] = bin.charCodeAt(i);
  return out;
}

/** No-op function reused as a stable reference. */
export const NOOP = (): void => {};
