import type {
  ConsolidationState,
  CortextContext,
  Retention,
} from "./types.js";

const RETENTION_VALUES: Record<string, number> = {
  natural: 0,
  durable: 1,
  boundary: 2,
  ephemeral: 3,
};

/**
 * Map a retention name or integer to the C ABI value (0–3).
 * @throws {TypeError} when the value is not a known retention.
 */
export function retentionValue(retention: Retention = "natural"): number {
  if (
    typeof retention === "number" &&
    Number.isInteger(retention) &&
    retention >= 0 &&
    retention <= 3
  ) {
    return retention;
  }
  if (
    typeof retention === "string" &&
    Object.prototype.hasOwnProperty.call(RETENTION_VALUES, retention)
  ) {
    return RETENTION_VALUES[retention] as number;
  }
  throw new TypeError(
    "retention must be natural, durable, boundary, or ephemeral"
  );
}

/**
 * Validate an evidence budget (bytes) for the C ABI: omitted or 0 = unset.
 * @throws {TypeError} when the value is not a whole number of bytes that fits
 * the 32-bit WASM size_t.
 */
export function evidenceBudgetValue(evidenceBudgetBytes?: number): number {
  if (evidenceBudgetBytes === undefined) {
    return 0;
  }
  if (
    typeof evidenceBudgetBytes !== "number" ||
    !Number.isInteger(evidenceBudgetBytes) ||
    evidenceBudgetBytes < 0 ||
    evidenceBudgetBytes > 0xffffffff
  ) {
    throw new TypeError(
      "evidenceBudgetBytes must be a whole number of bytes (0 to 2^32-1)"
    );
  }
  return evidenceBudgetBytes;
}

/** C ABI view of a query reference time (cortext_process_json_options). */
export interface ReferenceTimeValue {
  /** 1 when `referenceMs` is set, else 0 (retrieval unchanged). */
  hasReferenceMs: number;
  /** Reference time in ms since the Unix epoch (0 when unset). */
  referenceMs: number;
  /** 1 when memories stored after `referenceMs` are hidden, else 0. */
  asOf: number;
}

/**
 * Validate a query reference time for the C ABI.
 *
 * `referenceMs` is ms since the Unix epoch (a whole, non-negative safe
 * integer) or a `Date`; omitted leaves retrieval unchanged. `asOf` hides
 * memories stored after it and needs `referenceMs`.
 * @throws {TypeError} when the time is not a whole non-negative ms value, or
 * when `asOf` is set without `referenceMs`.
 */
export function referenceTimeValue(
  referenceMs?: number | Date,
  asOf = false
): ReferenceTimeValue {
  if (referenceMs === undefined) {
    if (asOf) {
      throw new TypeError("asOf needs referenceMs");
    }
    return { hasReferenceMs: 0, referenceMs: 0, asOf: 0 };
  }
  const ms = referenceMs instanceof Date ? referenceMs.getTime() : referenceMs;
  if (typeof ms !== "number" || !Number.isSafeInteger(ms) || ms < 0) {
    throw new TypeError(
      "referenceMs must be a Date or whole ms since the Unix epoch (0 to 2^53-1)"
    );
  }
  return { hasReferenceMs: 1, referenceMs: ms, asOf: asOf ? 1 : 0 };
}

/**
 * Ensure public process* objects always expose `consolidation_state`.
 * Older engine JSON emitted boolean consolidation_recommended/required only.
 */
export function normalizeContext(
  raw: Record<string, unknown>
): CortextContext {
  if (typeof raw.consolidation_state === "string") {
    return raw as CortextContext;
  }
  let state: ConsolidationState = "none";
  if (raw.consolidation_required === true) {
    state = "required";
  } else if (raw.consolidation_recommended === true) {
    state = "recommended";
  }
  return { ...raw, consolidation_state: state } as CortextContext;
}

/**
 * Validate image dimensions and buffer length before copying into WASM memory.
 * @throws {TypeError | RangeError} on invalid dimensions or undersized buffers.
 */
export function validateImageBuffer(
  pixels: ArrayLike<number>,
  width: number,
  height: number,
  channels: number
): number {
  if (
    !Number.isInteger(width) ||
    !Number.isInteger(height) ||
    !Number.isInteger(channels) ||
    width <= 0 ||
    height <= 0 ||
    channels <= 0
  ) {
    throw new TypeError(
      "width, height, and channels must be positive integers"
    );
  }
  if (
    width > 0x7fffffff ||
    height > 0x7fffffff ||
    channels > 0x7fffffff
  ) {
    throw new RangeError("image dimensions exceed the native int range");
  }
  const expected = width * height * channels;
  if (!Number.isSafeInteger(expected)) {
    throw new RangeError("image dimensions overflow addressable memory");
  }
  if (pixels.length < expected) {
    throw new RangeError(
      "image buffer is smaller than width * height * channels"
    );
  }
  return expected;
}
