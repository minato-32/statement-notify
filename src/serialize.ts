/** Versioned envelope + JSON (de)serialization that round-trips `Uint8Array`.
 *  The version lets a breaking change be detected and the store rebuilt rather
 *  than crash on incompatible persisted data. */

import { base64ToU8, u8ToBase64 } from "./util.js";

/** Current on-disk envelope version. Bump on any breaking blob-shape change. */
export const ENVELOPE_VERSION = 1;

export interface Envelope<T> {
  /** Envelope format version. */
  v: number;
  /** Consumer-declared record schema version (from store config). */
  s: number;
  /** Payload. */
  d: T;
}

function u8Replacer(_key: string, value: unknown): unknown {
  return value instanceof Uint8Array ? { $u8: u8ToBase64(value) } : value;
}

function u8Reviver(_key: string, value: unknown): unknown {
  if (
    value !== null &&
    typeof value === "object" &&
    typeof (value as { $u8?: unknown }).$u8 === "string"
  ) {
    return base64ToU8((value as { $u8: string }).$u8);
  }
  return value;
}

/** Serialize a value to a JSON string, encoding any `Uint8Array` fields. */
export function encodeJson(value: unknown): string {
  return JSON.stringify(value, u8Replacer);
}

/** Parse a JSON string, restoring any encoded `Uint8Array` fields. */
export function decodeJson<T>(text: string): T {
  return JSON.parse(text, u8Reviver) as T;
}

/** Wrap a payload in a versioned envelope and serialize it. */
export function encodeEnvelope<T>(payload: T, schemaVersion: number): string {
  const env: Envelope<T> = { v: ENVELOPE_VERSION, s: schemaVersion, d: payload };
  return encodeJson(env);
}

/**
 * Parse an envelope. Returns the payload only when both the envelope format and
 * the consumer's schema version match; otherwise returns `null` so the caller
 * treats persisted data as disposable and rebuilds from the live source.
 */
export function decodeEnvelope<T>(text: string, schemaVersion: number): T | null {
  let env: Envelope<T>;
  try {
    env = decodeJson<Envelope<T>>(text);
  } catch {
    return null;
  }
  if (env === null || typeof env !== "object") return null;
  if (env.v !== ENVELOPE_VERSION || env.s !== schemaVersion) return null;
  return env.d;
}
