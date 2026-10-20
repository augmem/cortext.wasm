import {
  normalizeContext,
  evidenceBudgetValue,
  referenceTimeValue,
  retentionValue,
  validateImageBuffer,
} from "./normalize.js";
import type {
  CortextContext,
  CortextEmbedding,
  CortextEmscriptenModule,
  CortextHandle,
  CortextModuleFactory,
  CreateContextOptions,
  Media,
  ProcessOptions,
  WriteLateInteractionModelFileOptions,
  WriteModelFileOptions,
} from "./types.js";

/** Virtual-FS directory the engine searches for the AIST model. */
export const AIST_MODEL_DIR = "/models/AIST-87M-GGUF";
/** Default virtual-FS path of the AIST GGUF encoder. */
export const AIST_MODEL_PATH = `${AIST_MODEL_DIR}/AIST-87M_q8_0.gguf`;
/** File name of the late-interaction reranker the engine requires with AIST. */
export const LI_MODEL_FILENAME = "AIST-87M-LI.gguf";
/** Default virtual-FS path of the late-interaction reranker GGUF. */
export const LI_MODEL_PATH = `${AIST_MODEL_DIR}/${LI_MODEL_FILENAME}`;

/** Default virtual-FS path of the AIST WordPiece tokenizer vocabulary. */
export const VOCAB_PATH = "/models/mdbr-leaf-ir/vocab.txt";

/** sizeof(cortext_process_json_options) on wasm32 (v5 layout). */
const PROCESS_OPTIONS_BYTES = 40;
/** sizeof(cortext_media) on wasm32: { data*, size_t size, mimetype* }. */
const MEDIA_DESCRIPTOR_BYTES = 12;

/**
 * Browser WebAssembly convenience wrapper over the Cortext C ABI.
 *
 * Load the Emscripten factory (vendored as `@augmem/cortext-wasm/module` or
 * produced by the engine monorepo `./build-wasm.sh`), then:
 *
 * ```ts
 * import createCortextModule from "@augmem/cortext-wasm/module";
 * import { CortextWasm } from "@augmem/cortext-wasm";
 *
 * const runtime = await CortextWasm.create(createCortextModule);
 * await runtime.writeModelFile(aistFile);
 * await runtime.writeLateInteractionModelFile(liFile);
 * const handle = runtime.createContext({ dbPath: ":memory:" });
 * const ctx = runtime.processText(handle, "hello", "browser");
 * ```
 */
export class CortextWasm {
  readonly module: CortextEmscriptenModule;

  constructor(module: CortextEmscriptenModule) {
    this.module = module;
  }

  /** Instantiate the Emscripten module and wrap it. */
  static async create(
    moduleFactory: CortextModuleFactory,
    options: Record<string, unknown> = {}
  ): Promise<CortextWasm> {
    const module = await moduleFactory(options);
    return new CortextWasm(module);
  }

  /** Recursively create directories on the Emscripten virtual FS. */
  mkdirp(path: string): void {
    const parts = path.split("/").filter(Boolean);
    let current = "";
    for (const part of parts) {
      current += `/${part}`;
      try {
        this.module.FS.mkdir(current);
      } catch (err) {
        if (!isExistsError(err)) {
          throw err;
        }
      }
    }
  }

  /** Write bytes to a path, creating parent directories as needed. */
  writeFile(path: string, bytes: Uint8Array | string): void {
    const slash = path.lastIndexOf("/");
    if (slash > 0) {
      this.mkdirp(path.slice(0, slash));
    }
    this.module.FS.writeFile(path, bytes);
  }

  /**
   * Load a GGUF model file (e.g. from an HTML `<input type="file">`) into
   * the virtual filesystem for the engine to open.
   */
  async writeModelFile(
    file: Blob | ArrayBuffer | Uint8Array,
    {
      directory = AIST_MODEL_DIR,
      filename = "AIST-87M_q8_0.gguf",
    }: WriteModelFileOptions = {}
  ): Promise<string> {
    const path = `${directory}/${filename}`;
    this.writeFile(path, await modelBytes(file));
    return path;
  }

  /**
   * Load the late-interaction reranker GGUF (`AIST-87M-LI.gguf`) into the
   * virtual filesystem beside the AIST model. The engine requires it whenever
   * an AIST model is present: `createContext` throws without it. Pass the same
   * `directory` given to `writeModelFile`.
   */
  async writeLateInteractionModelFile(
    file: Blob | ArrayBuffer | Uint8Array,
    { directory = AIST_MODEL_DIR }: WriteLateInteractionModelFileOptions = {}
  ): Promise<string> {
    const path = `${directory}/${LI_MODEL_FILENAME}`;
    this.writeFile(path, await modelBytes(file));
    return path;
  }

  /**
   * Load the AIST tokenizer vocabulary (`mdbr-leaf-ir/vocab.txt` in the
   * engine's model tree) into the virtual filesystem. The engine reads it
   * from `<models>/mdbr-leaf-ir/vocab.txt`, beside the AIST model directory.
   */
  async writeTokenizerVocabFile(
    file: Blob | ArrayBuffer | Uint8Array,
    { path = VOCAB_PATH }: { path?: string } = {}
  ): Promise<string> {
    this.writeFile(path, await modelBytes(file));
    return path;
  }

  createContext({
    focus = 0.5,
    sensitivity = 0.5,
    stability = 0.5,
    dbPath = ":memory:",
  }: CreateContextOptions = {}): CortextHandle {
    const dbPathPtr = this.#writeString(dbPath);
    try {
      const handle = this.module._cortext_create(
        focus,
        sensitivity,
        stability,
        dbPathPtr
      );
      if (!handle) {
        throw new Error(this.lastError() || "Failed to create Cortext context");
      }
      return handle;
    } finally {
      this.module._free(dbPathPtr);
    }
  }

  freeContext(handle: CortextHandle | null | undefined): void {
    if (handle) {
      this.module._cortext_free(handle);
    }
  }

  reset(handle: CortextHandle): void {
    this.#checkStatus(this.module._cortext_reset(handle));
  }

  flush(handle: CortextHandle): void {
    this.#checkStatus(this.module._cortext_flush(handle));
  }

  consolidate(handle: CortextHandle): void {
    this.#checkStatus(this.module._cortext_consolidate(handle));
  }

  version(): string {
    return this.module.UTF8ToString(this.module._cortext_version());
  }

  lastError(): string {
    const ptr = this.module._cortext_last_error();
    return ptr ? this.module.UTF8ToString(ptr) : "";
  }

  embedText(handle: CortextHandle, text: string): CortextEmbedding {
    const textPtr = this.#writeString(text);
    try {
      return this.#readRawJson(
        this.module._cortext_embed_text_json(handle, textPtr)
      ) as CortextEmbedding;
    } finally {
      this.module._free(textPtr);
    }
  }

  processText(
    handle: CortextHandle,
    text: string,
    sourceId = "browser",
    {
      includeEmbedding = true,
      retention = "natural",
      evidenceBudgetBytes,
      referenceMs,
      asOf = false,
    }: ProcessOptions = {}
  ): CortextContext {
    // Validate options before WASM allocations so callers get a clean TypeError.
    const retentionCode = retentionValue(retention);
    const evidenceBudget = evidenceBudgetValue(evidenceBudgetBytes);
    const referenceTime = referenceTimeValue(referenceMs, asOf);
    const textPtr = this.#writeString(text);
    const sourcePtr = this.#writeString(sourceId);
    try {
      return normalizeContext(
        this.#readRawJson(
          this.module._cortext_wasm_process_text_json(
            handle,
            textPtr,
            sourcePtr,
            includeEmbedding ? 1 : 0,
            retentionCode,
            evidenceBudget,
            referenceTime.hasReferenceMs,
            referenceTime.referenceMs,
            referenceTime.asOf
          )
        )
      );
    } finally {
      this.module._free(textPtr);
      this.module._free(sourcePtr);
    }
  }

  /**
   * Process canonical text while storing an optional caller-provided media
   * payload in its place. The payload bytes are copied into WASM memory and
   * passed with their MIME type; the text remains the canonical embedding
   * input. `null` or empty `data` stores the canonical text.
   *
   * Takes the same options as `processText`, including the evidence budget
   * and query reference time.
   */
  processTextWithMedia(
    handle: CortextHandle,
    text: string,
    sourceId = "browser",
    media: Media | null = null,
    {
      includeEmbedding = true,
      retention = "natural",
      evidenceBudgetBytes,
      referenceMs,
      asOf = false,
    }: ProcessOptions = {}
  ): CortextContext {
    // Validate options before any WASM allocation, matching processText.
    const retentionCode = retentionValue(retention);
    const evidenceBudget = evidenceBudgetValue(evidenceBudgetBytes);
    const referenceTime = referenceTimeValue(referenceMs, asOf);
    const processTextWithMedia =
      this.module._cortext_process_text_with_media_json_with_options;
    if (typeof processTextWithMedia !== "function") {
      throw new Error(
        "processTextWithMedia requires a media-capable WASM asset; update the loaded asset before calling this method"
      );
    }
    let data: Uint8Array | null = null;
    if (media !== null) {
      data =
        media.data instanceof Uint8Array ? media.data : new Uint8Array(media.data);
      if (data.byteLength > 0xffffffff) {
        throw new RangeError("media payload exceeds the native size range");
      }
      if (typeof media.mimetype !== "string") {
        throw new TypeError("media mimetype must be a string");
      }
    }
    let textPtr = 0;
    let sourcePtr = 0;
    let dataPtr = 0;
    let mimetypePtr = 0;
    let mediaPtr = 0;
    let optionsPtr = 0;
    try {
      textPtr = this.#writeString(text);
      sourcePtr = this.#writeString(sourceId);

      if (media !== null && data !== null) {
        if (data.byteLength > 0) {
          dataPtr = this.module._malloc(data.byteLength);
          if (!dataPtr) {
            throw new Error("Failed to allocate media buffer");
          }
          this.module.HEAPU8.set(data, dataPtr);
        }
        mimetypePtr = this.#writeString(media.mimetype);

        // cortext_media is { const uint8_t* data; size_t size;
        // const char* mimetype; } (12 bytes on wasm32).
        mediaPtr = this.#mallocZeroed(MEDIA_DESCRIPTOR_BYTES);
        this.#writeUint32(mediaPtr, dataPtr);
        this.#writeUint32(mediaPtr + 4, data.byteLength);
        this.#writeUint32(mediaPtr + 8, mimetypePtr);
      }

      // cortext_process_json_options on wasm32 (40 bytes): size_t struct_size
      // @0, int include_embedding @4, int retention @8, int reserved @12,
      // size_t evidence_budget_bytes @16, int has_reference_ms @20, int as_of
      // @24, (pad) uint64_t reference_ms @32.
      optionsPtr = this.#mallocZeroed(PROCESS_OPTIONS_BYTES);
      this.#writeUint32(optionsPtr, PROCESS_OPTIONS_BYTES);
      this.#writeUint32(optionsPtr + 4, includeEmbedding ? 1 : 0);
      this.#writeUint32(optionsPtr + 8, retentionCode);
      this.#writeUint32(optionsPtr + 16, evidenceBudget);
      this.#writeUint32(optionsPtr + 20, referenceTime.hasReferenceMs);
      this.#writeUint32(optionsPtr + 24, referenceTime.asOf);
      this.#writeUint32(optionsPtr + 32, referenceTime.referenceMs % 2 ** 32);
      this.#writeUint32(
        optionsPtr + 36,
        Math.floor(referenceTime.referenceMs / 2 ** 32)
      );

      return normalizeContext(
        this.#readRawJson(
          processTextWithMedia(
            handle,
            textPtr,
            sourcePtr,
            mediaPtr,
            optionsPtr
          )
        )
      );
    } finally {
      if (optionsPtr) this.module._free(optionsPtr);
      if (mediaPtr) this.module._free(mediaPtr);
      if (mimetypePtr) this.module._free(mimetypePtr);
      if (dataPtr) this.module._free(dataPtr);
      if (sourcePtr) this.module._free(sourcePtr);
      if (textPtr) this.module._free(textPtr);
    }
  }

  embedAudio(
    handle: CortextHandle,
    samples: Float32Array | ArrayLike<number>
  ): CortextEmbedding {
    const sampleArray =
      samples instanceof Float32Array
        ? samples
        : new Float32Array(samples as ArrayLike<number>);
    const bytes = sampleArray.length * sampleArray.BYTES_PER_ELEMENT;
    const pcmPtr = this.module._malloc(bytes);
    if (!pcmPtr) {
      throw new Error("Failed to allocate audio buffer");
    }
    try {
      this.module.HEAPF32.set(
        sampleArray,
        pcmPtr / sampleArray.BYTES_PER_ELEMENT
      );
      return this.#readRawJson(
        this.module._cortext_embed_audio_json(
          handle,
          pcmPtr,
          sampleArray.length
        )
      ) as CortextEmbedding;
    } finally {
      this.module._free(pcmPtr);
    }
  }

  embedImage(
    handle: CortextHandle,
    pixels: Uint8Array | ArrayLike<number>,
    width: number,
    height: number,
    channels: number
  ): CortextEmbedding {
    const pixelArray =
      pixels instanceof Uint8Array ? pixels : new Uint8Array(pixels);
    validateImageBuffer(pixelArray, width, height, channels);
    const dataPtr = this.module._malloc(pixelArray.length);
    if (!dataPtr) {
      throw new Error("Failed to allocate image buffer");
    }
    try {
      this.module.HEAPU8.set(pixelArray, dataPtr);
      return this.#readRawJson(
        this.module._cortext_embed_image_json(
          handle,
          dataPtr,
          width,
          height,
          channels
        )
      ) as CortextEmbedding;
    } finally {
      this.module._free(dataPtr);
    }
  }

  #mallocZeroed(size: number): number {
    const ptr = this.module._malloc(size);
    if (!ptr) {
      throw new Error("Failed to allocate WASM struct");
    }
    this.module.HEAPU8.fill(0, ptr, ptr + size);
    return ptr;
  }

  #writeUint32(ptr: number, value: number): void {
    if (!Number.isInteger(value) || value < 0 || value > 0xffffffff) {
      throw new RangeError("WASM field exceeds the uint32 range");
    }
    const heap = this.module.HEAPU8;
    heap[ptr] = value & 0xff;
    heap[ptr + 1] = (value >>> 8) & 0xff;
    heap[ptr + 2] = (value >>> 16) & 0xff;
    heap[ptr + 3] = (value >>> 24) & 0xff;
  }

  #writeString(value: string): number {
    const size = this.module.lengthBytesUTF8(value) + 1;
    const ptr = this.module._malloc(size);
    if (!ptr) {
      throw new Error("Failed to allocate string");
    }
    this.module.stringToUTF8(value, ptr, size);
    return ptr;
  }

  #readRawJson(ptr: number): Record<string, unknown> {
    if (!ptr) {
      throw new Error(this.lastError() || "Cortext returned null JSON");
    }
    try {
      return JSON.parse(
        this.module.UTF8ToString(ptr)
      ) as Record<string, unknown>;
    } finally {
      this.module._cortext_string_free(ptr);
    }
  }

  #checkStatus(status: number): void {
    if (status !== 0) {
      throw new Error(
        this.lastError() || `Cortext call failed with status ${status}`
      );
    }
  }
}

/** Emscripten's EEXIST errno (musl numbering, fixed across releases). */
const EMSCRIPTEN_EEXIST = 20;

/**
 * Whether an Emscripten FS error is EEXIST. Older glue set `code`; current
 * glue (`ErrnoError`) sets only the numeric `errno`.
 */
function isExistsError(err: unknown): boolean {
  if (!err || typeof err !== "object") {
    return false;
  }
  const { code, errno } = err as { code?: unknown; errno?: unknown };
  return code === "EEXIST" || errno === EMSCRIPTEN_EEXIST;
}

async function modelBytes(
  file: Blob | ArrayBuffer | Uint8Array
): Promise<Uint8Array> {
  if (file instanceof Uint8Array) {
    return file;
  }
  if (file instanceof ArrayBuffer) {
    return new Uint8Array(file);
  }
  return new Uint8Array(await file.arrayBuffer());
}
