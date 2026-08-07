import {
  normalizeContext,
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
  WriteModelFileOptions,
} from "./types.js";

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
 * await runtime.writeModelFile(fileInput.files[0]);
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
        const code =
          err && typeof err === "object" && "code" in err
            ? (err as { code?: string }).code
            : undefined;
        if (code !== "EEXIST") {
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
      directory = "/models/AIST-87M-GGUF",
      filename = "AIST-87M_q8_0.gguf",
    }: WriteModelFileOptions = {}
  ): Promise<string> {
    let bytes: Uint8Array;
    if (file instanceof Uint8Array) {
      bytes = file;
    } else if (file instanceof ArrayBuffer) {
      bytes = new Uint8Array(file);
    } else {
      bytes = new Uint8Array(await file.arrayBuffer());
    }
    const path = `${directory}/${filename}`;
    this.writeFile(path, bytes);
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
    { includeEmbedding = true, retention = "natural" }: ProcessOptions = {}
  ): CortextContext {
    // Validate retention before WASM allocations so callers get a clean TypeError.
    const retentionCode = retentionValue(retention);
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
            retentionCode
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
   * payload. The payload bytes are copied into WASM memory and passed with
   * their MIME type; the text remains the canonical embedding input.
   *
   * Requires a WASM module built from the media-capable C API. Passing null
   * preserves the C API's no-payload behavior without changing processText.
   */
  processTextWithMedia(
    handle: CortextHandle,
    text: string,
    sourceId = "browser",
    media: Media | null = null,
    { includeEmbedding = true, retention = "natural" }: ProcessOptions = {}
  ): CortextContext {
    // Validate retention before any WASM allocation, matching processText.
    const retentionCode = retentionValue(retention);
    const processTextWithMedia =
      this.module._cortext_process_text_with_media_json_with_options;
    if (typeof processTextWithMedia !== "function") {
      throw new Error(
        "processTextWithMedia requires a media-capable WASM asset; update the loaded asset before calling this method"
      );
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

      if (media !== null) {
        const data =
          media.data instanceof Uint8Array
            ? media.data
            : new Uint8Array(media.data);
        if (data.byteLength > 0xffffffff) {
          throw new RangeError("media payload exceeds the native size range");
        }
        if (typeof media.mimetype !== "string") {
          throw new TypeError("media mimetype must be a string");
        }

        if (data.byteLength > 0) {
          dataPtr = this.module._malloc(data.byteLength);
          if (!dataPtr) {
            throw new Error("Failed to allocate media buffer");
          }
          this.module.HEAPU8.set(data, dataPtr);
        }
        mimetypePtr = this.#writeString(media.mimetype);

        // cortext_media is { const uint8_t* data; size_t size;
        // const char* mimetype; }. Emscripten's wasm32 ABI uses 12 bytes.
        mediaPtr = this.module._malloc(12);
        if (!mediaPtr) {
          throw new Error("Failed to allocate media descriptor");
        }
        this.#writeUint32(mediaPtr, dataPtr);
        this.#writeUint32(mediaPtr + 4, data.byteLength);
        this.#writeUint32(mediaPtr + 8, mimetypePtr);
      }

      // cortext_process_json_options is { size_t struct_size; int
      // include_embedding; int retention; int reserved; } (16 bytes on
      // wasm32). Use the media-capable JSON C API directly so arbitrary bytes
      // are not coerced through a JavaScript string or base64 representation.
      optionsPtr = this.module._malloc(16);
      if (!optionsPtr) {
        throw new Error("Failed to allocate process options");
      }
      this.#writeUint32(optionsPtr, 16);
      this.#writeUint32(optionsPtr + 4, includeEmbedding ? 1 : 0);
      this.#writeUint32(optionsPtr + 8, retentionCode);
      this.#writeUint32(optionsPtr + 12, 0);

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
