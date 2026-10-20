/** Engine configuration knobs (0–1 floats unless noted). */
export interface CortextConfig {
  focus?: number;
  sensitivity?: number;
  stability?: number;
  affectInterrupt?: boolean;
  affectRetrieval?: boolean;
  reinforcementEnabled?: boolean;
  sequentialEdgesEnabled?: boolean;
  signalFilterAudioEnabled?: boolean;
  signalFilterImageEnabled?: boolean;
  signalFilterTextEnabled?: boolean;
}

/** One stored signal payload of a memory, in signal order. */
export interface CortextMemoryContent {
  size_bytes: number;
  /** MIME type of this payload (for example "text/plain" or "image/jpeg"). */
  mimetype: string;
  /** Payload bytes, base64-encoded; decode according to `mimetype`. */
  base64: string;
  /**
   * When this payload's signal was observed, in ms since the Unix epoch;
   * 0 means unknown.
   */
  timestamp: number;
}

/** One retrieved or working-memory item from process* output. */
export interface CortextMemory {
  id?: number | string;
  memory_id?: number | string;
  source_id?: string;
  timestamp?: number;
  /**
   * The modality the memory's signals share ("text", "audio", "image"), or
   * "mixed" when its signals have different modalities.
   */
  modality?: string;
  /** MIME type of the memory's first signal; see `content` for every payload. */
  mimetype?: string;
  /** Every signal payload of the memory, each with its own MIME type. */
  content?: CortextMemoryContent[];
  relevance?: number;
  composite_score?: number;
  salience?: number;
  contradiction?: number;
  usage_count?: number;
  [key: string]: unknown;
}

export type ConsolidationState = "none" | "recommended" | "required";

/** Structured process* response (parsed from process* JSON). */
export interface CortextContext {
  /**
   * Standing directives for a query ("Always ...", "I prefer ..."), outside
   * the retrieved ranking: each entry holds only the stored signals that state
   * a directive. Show it ahead of `retrieved_memory`; it does not count
   * against a cut of the retrieved list (an evidence budget counts it).
   */
  standing_memory?: CortextMemory[];
  retrieved_memory?: CortextMemory[];
  working_memory?: CortextMemory[];
  should_interrupt?: boolean;
  interrupt_aborted?: boolean;
  at_boundary?: boolean;
  consolidation_state: ConsolidationState;
  output?: Record<string, unknown>;
  embedding?: number[];
  embedding_dimension?: number;
  encode_ms?: number;
  process_ms?: number;
  hydrate_ms?: number;
  total_ms?: number;
  [key: string]: unknown;
}

export interface CortextEmbedding {
  embedding: number[];
  dimension: number;
  [key: string]: unknown;
}

/**
 * Caller-provided source payload stored in place of the canonical text of a
 * processed signal. Empty `data` stores the canonical text instead. The MIME
 * type decides whether the stored payload counts as text (`text/*`) — for
 * example toward an evidence budget — or as media.
 */
export interface Media {
  /** Arbitrary binary bytes; they are copied without text decoding. */
  data: Uint8Array | ArrayBuffer;
  /** MIME type stored alongside the payload (for example, image/png). */
  mimetype: string;
}

/** Matches cortext::Retention / C API cortext_retention. */
export type Retention =
  | "natural"
  | "durable"
  | "boundary"
  | "ephemeral"
  | 0
  | 1
  | 2
  | 3;

export interface ProcessOptions {
  includeEmbedding?: boolean;
  /** Natural when omitted: boundary and write algorithms decide. */
  retention?: Retention;
  /**
   * Evidence budget in bytes for the returned packet. Omitted (or 0): recalled
   * memories come back whole. Set: `standing_memory` plus `retrieved_memory`
   * (with attached neighbours) fit within it, text counted by its UTF-8 bytes
   * and other payloads as 480 bytes each; grouped memories keep their members
   * most similar to the query, and more distinct memories are kept trimmed
   * before lower-ranked ones are left out. Convert a token budget with the
   * reader's tokenizer rate (8,000 tokens at 4.35 chars/token is 34,800).
   */
  evidenceBudgetBytes?: number;
  /**
   * Query reference time: a `Date` or ms since the Unix epoch, past or
   * future. Adds the long-term memories nearest that time as retrieval
   * candidates. Only `"ephemeral"` (query) calls read it; omitted leaves
   * retrieval unchanged.
   */
  referenceMs?: number | Date;
  /**
   * With `referenceMs`: also hide memories stored after it, so the answer is
   * what was known at that time. Requires `referenceMs`.
   */
  asOf?: boolean;
}

export interface CreateContextOptions {
  focus?: number;
  sensitivity?: number;
  stability?: number;
  dbPath?: string;
}

/** Where `writeLateInteractionModelFile` places the LI reranker GGUF. */
export interface WriteLateInteractionModelFileOptions {
  /** Directory of the AIST model; the engine looks for LI beside it. */
  directory?: string;
}

export interface WriteModelFileOptions {
  directory?: string;
  filename?: string;
}

/**
 * Minimal shape of the Emscripten module produced by `build-wasm.sh`.
 * Field names match the monorepo `bindings/wasm` convenience wrapper.
 */
export interface CortextEmscriptenModule {
  FS: {
    mkdir: (path: string) => void;
    writeFile: (path: string, data: Uint8Array | string) => void;
  };
  HEAPU8: Uint8Array;
  HEAPF32: Float32Array;
  _malloc: (size: number) => number;
  _free: (ptr: number) => void;
  lengthBytesUTF8: (str: string) => number;
  stringToUTF8: (str: string, outPtr: number, maxBytesToWrite: number) => number;
  UTF8ToString: (ptr: number) => string;
  _cortext_create: (
    focus: number,
    sensitivity: number,
    stability: number,
    dbPathPtr: number
  ) => number;
  _cortext_free: (handle: number) => void;
  _cortext_reset: (handle: number) => number;
  _cortext_flush: (handle: number) => number;
  _cortext_consolidate: (handle: number) => number;
  _cortext_version: () => number;
  _cortext_last_error: () => number;
  _cortext_string_free: (ptr: number) => void;
  _cortext_embed_text_json: (handle: number, textPtr: number) => number;
  _cortext_embed_audio_json: (
    handle: number,
    pcmPtr: number,
    sampleCount: number
  ) => number;
  _cortext_embed_image_json: (
    handle: number,
    dataPtr: number,
    width: number,
    height: number,
    channels: number
  ) => number;
  _cortext_wasm_process_text_json: (
    handle: number,
    textPtr: number,
    sourcePtr: number,
    includeEmbedding: number,
    retention: number,
    evidenceBudgetBytes: number,
    hasReferenceMs: number,
    referenceMs: number,
    asOf: number
  ) => number;
  _cortext_process_text_with_media_json_with_options?: (
    handle: number,
    textPtr: number,
    sourcePtr: number,
    mediaPtr: number,
    optionsPtr: number
  ) => number;
  [key: string]: unknown;
}

/** Emscripten factory: `export default createCortextModule`. */
export type CortextModuleFactory = (
  options?: Record<string, unknown>
) => Promise<CortextEmscriptenModule> | CortextEmscriptenModule;

/** Opaque engine handle returned by createContext (pointer as number). */
export type CortextHandle = number;
