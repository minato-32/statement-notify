/** Versioned envelope + JSON (de)serialization that round-trips `Uint8Array`
 *  and `bigint` (e.g. a statement's `expiry`).
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
  if (value instanceof Uint8Array) return { $u8: u8ToBase64(value) };
  if (typeof value === "bigint") return { $big: value.toString() };
  return value;
}

/** True only for an exact tag this module writes: a plain object whose single
 *  key is `key` with a string value. Objects that merely contain the key are
 *  app data and pass through untouched. */
function isTag(value: unknown, key: "$u8" | "$big"): value is Record<string, string> {
  return (
    value !== null &&
    typeof value === "object" &&
    !Array.isArray(value) &&
    Object.keys(value).length === 1 &&
    typeof (value as Record<string, unknown>)[key] === "string"
  );
}

// A tag that fails to decode is returned as-is, so one bad value (e.g. from an
// untrusted payload) can't throw and discard the whole persisted blob.
function u8Reviver(_key: string, value: unknown): unknown {
  if (isTag(value, "$u8")) {
    try {
      return base64ToU8(value.$u8 as string);
    } catch {
      return value;
    }
  }
  // The replacer always writes a plain decimal; anything else (e.g. "" or
  // "0x10", which BigInt() would accept) isn't ours.
  if (isTag(value, "$big") && /^-?\d+$/.test(value.$big as string)) {
    try {
      return BigInt(value.$big as string);
    } catch {
      return value;
    }
  }
  return value;
}

/** Serialize a value to a JSON string, encoding any `Uint8Array` / `bigint` fields. */
export function encodeJson(value: unknown): string {
  return JSON.stringify(value, u8Replacer);
}

/** Parse a JSON string, restoring any encoded `Uint8Array` / `bigint` fields. */
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
