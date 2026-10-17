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

/** One retrieved or working-memory item from process* output. */
export interface CortextMemory {
  id?: number | string;
  memory_id?: number | string;
  text?: string;
  source_id?: string;
  timestamp?: number;
  modality?: string;
  mimetype?: string;
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
}

export interface CreateContextOptions {
  focus?: number;
  sensitivity?: number;
  stability?: number;
  dbPath?: string;
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
    retention: number
  ) => number;
  [key: string]: unknown;
}

/** Emscripten factory: `export default createCortextModule`. */
export type CortextModuleFactory = (
  options?: Record<string, unknown>
) => Promise<CortextEmscriptenModule> | CortextEmscriptenModule;

/** Opaque engine handle returned by createContext (pointer as number). */
export type CortextHandle = number;
