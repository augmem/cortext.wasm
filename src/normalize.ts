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
