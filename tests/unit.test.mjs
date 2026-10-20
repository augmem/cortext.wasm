import assert from "node:assert/strict";
import path from "node:path";
import { fileURLToPath, pathToFileURL } from "node:url";
import test from "node:test";

const root = path.resolve(path.dirname(fileURLToPath(import.meta.url)), "..");
const esm = await import(
  pathToFileURL(path.join(root, "dist", "esm", "index.js")).href
);

test("retentionValue maps names and integers", () => {
  assert.equal(esm.retentionValue("natural"), 0);
  assert.equal(esm.retentionValue("durable"), 1);
  assert.equal(esm.retentionValue("boundary"), 2);
  assert.equal(esm.retentionValue("ephemeral"), 3);
  assert.equal(esm.retentionValue(0), 0);
  assert.equal(esm.retentionValue(3), 3);
  assert.equal(esm.retentionValue(), 0);
});

test("retentionValue rejects invalid values", () => {
  assert.throws(() => esm.retentionValue("sticky"), /retention must be/);
  assert.throws(() => esm.retentionValue(4), /retention must be/);
  assert.throws(() => esm.retentionValue(-1), /retention must be/);
  assert.throws(() => esm.retentionValue(1.5), /retention must be/);
});

test("evidenceBudgetValue maps unset to 0 and keeps whole bytes", () => {
  assert.equal(esm.evidenceBudgetValue(), 0);
  assert.equal(esm.evidenceBudgetValue(0), 0);
  assert.equal(esm.evidenceBudgetValue(34_800), 34_800);
  assert.equal(esm.evidenceBudgetValue(0xffffffff), 0xffffffff);
});

test("evidenceBudgetValue rejects invalid values", () => {
  assert.throws(() => esm.evidenceBudgetValue(-1), /evidenceBudgetBytes/);
  assert.throws(() => esm.evidenceBudgetValue(1.5), /evidenceBudgetBytes/);
  assert.throws(() => esm.evidenceBudgetValue(2 ** 32), /evidenceBudgetBytes/);
  assert.throws(() => esm.evidenceBudgetValue("8000"), /evidenceBudgetBytes/);
});

test("processText passes the evidence budget to the WASM export", () => {
  const calls = [];
  const fakeModule = {
    _malloc: () => 8,
    _free: () => {},
    lengthBytesUTF8: (s) => s.length,
    stringToUTF8: () => {},
    UTF8ToString: () => '{"consolidation_state":"none","standing_memory":[],"retrieved_memory":[]}',
    _cortext_string_free: () => {},
    _cortext_wasm_process_text_json: (...args) => {
      calls.push(args);
      return 16;
    },
  };
  const wasm = new esm.CortextWasm(fakeModule);
  const ctx = wasm.processText(1, "q", "query", {
    retention: "ephemeral",
    evidenceBudgetBytes: 34_800,
  });
  assert.deepEqual(ctx.standing_memory, []);
  assert.equal(calls.length, 1);
  assert.deepEqual(calls[0].slice(3), [1, 3, 34_800, 0, 0, 0]);
  wasm.processText(1, "q", "query", { retention: "ephemeral" });
  assert.deepEqual(calls[1].slice(3), [1, 3, 0, 0, 0, 0]);
});

test("normalizeContext keeps string consolidation_state", () => {
  const out = esm.normalizeContext({
    consolidation_state: "recommended",
    should_interrupt: false,
  });
  assert.equal(out.consolidation_state, "recommended");
  assert.equal(out.should_interrupt, false);
});

test("normalizeContext maps legacy boolean flags", () => {
  assert.equal(
    esm.normalizeContext({ consolidation_required: true }).consolidation_state,
    "required"
  );
  assert.equal(
    esm.normalizeContext({ consolidation_recommended: true })
      .consolidation_state,
    "recommended"
  );
  assert.equal(
    esm.normalizeContext({
      consolidation_recommended: true,
      consolidation_required: true,
    }).consolidation_state,
    "required"
  );
  assert.equal(
    esm.normalizeContext({ should_interrupt: true }).consolidation_state,
    "none"
  );
});

test("validateImageBuffer accepts valid RGB buffer", () => {
  const pixels = new Uint8Array(2 * 3 * 3);
  assert.equal(esm.validateImageBuffer(pixels, 2, 3, 3), 18);
});

test("validateImageBuffer rejects bad dimensions and short buffers", () => {
  assert.throws(
    () => esm.validateImageBuffer(new Uint8Array(10), 0, 1, 3),
    /positive integers/
  );
  assert.throws(
    () => esm.validateImageBuffer(new Uint8Array(10), 1.5, 1, 3),
    /positive integers/
  );
  assert.throws(
    () => esm.validateImageBuffer(new Uint8Array(5), 2, 2, 3),
    /smaller than width/
  );
});

test("CortextWasm class is exported", () => {
  assert.equal(typeof esm.CortextWasm, "function");
  assert.equal(typeof esm.CortextWasm.create, "function");
  assert.equal(esm.PACKAGE_VERSION, "2.0.0");
});

function makeFakeModule(overrides = {}) {
  let nextPtr = 16;
  const strings = new Map();
  const heapU8 = new Uint8Array(4096);
  const module = {
    FS: { mkdir() {}, writeFile() {} },
    HEAPU8: heapU8,
    HEAPF32: new Float32Array(1024),
    _malloc: (n) => {
      const ptr = nextPtr;
      nextPtr += Math.max(n, 8);
      return ptr;
    },
    _free() {},
    lengthBytesUTF8: (s) => Buffer.byteLength(s, "utf8"),
    stringToUTF8: (value, ptr, maxBytesToWrite) => {
      const bytes = new TextEncoder().encode(value);
      heapU8.set(bytes.subarray(0, maxBytesToWrite - 1), ptr);
      heapU8[ptr + Math.min(bytes.length, maxBytesToWrite - 1)] = 0;
    },
    UTF8ToString: (ptr) => strings.get(ptr) ?? "",
    _setString: (ptr, value) => strings.set(ptr, value),
    _cortext_create: () => 1,
    _cortext_free() {},
    _cortext_reset: () => 0,
    _cortext_flush: () => 0,
    _cortext_consolidate: () => 0,
    _cortext_version: () => {
      const ptr = nextPtr;
      nextPtr += 16;
      strings.set(ptr, "1.2.0");
      return ptr;
    },
    _cortext_last_error: () => 0,
    _cortext_string_free(ptr) {
      strings.delete(ptr);
    },
    _cortext_embed_text_json: () => 0,
    _cortext_embed_audio_json: () => 0,
    _cortext_embed_image_json: () => 0,
    _cortext_wasm_process_text_json: () => {
      const ptr = nextPtr;
      nextPtr += 16;
      strings.set(
        ptr,
        JSON.stringify({
          consolidation_recommended: true,
          consolidation_required: false,
          should_interrupt: false,
        })
      );
      return ptr;
    },
    _cortext_process_text_with_media_json_with_options: () => {
      const ptr = nextPtr;
      nextPtr += 16;
      strings.set(
        ptr,
        JSON.stringify({
          consolidation_recommended: true,
          consolidation_required: false,
          should_interrupt: false,
        })
      );
      return ptr;
    },
  };
  return Object.assign(module, overrides);
}

test("CortextWasm processText validates retention without loading WASM", () => {
  const runtime = new esm.CortextWasm(makeFakeModule({ _malloc: () => 0 }));
  assert.throws(
    () => runtime.processText(1, "x", "s", { retention: "nope" }),
    /retention must be/
  );
  assert.throws(
    () => runtime.embedImage(1, new Uint8Array(1), 0, 1, 3),
    /positive integers/
  );
});

test("CortextWasm processText normalizes legacy consolidation flags", () => {
  const runtime = new esm.CortextWasm(makeFakeModule());
  const ctx = runtime.processText(1, "hello", "browser", {
    retention: "ephemeral",
    includeEmbedding: false,
  });
  assert.equal(ctx.consolidation_state, "recommended");
  assert.equal(ctx.should_interrupt, false);
});

test("CortextWasm processTextWithMedia rejects old WASM assets", () => {
  const fake = makeFakeModule({
    _cortext_process_text_with_media_json_with_options: undefined,
    _malloc: () => {
      throw new Error("WASM allocation should not be attempted");
    },
  });
  const runtime = new esm.CortextWasm(fake);

  assert.throws(
    () => runtime.processTextWithMedia(1, "canonical text"),
    /processTextWithMedia requires a media-capable WASM asset/
  );
});

test("CortextWasm processTextWithMedia preserves binary payload and MIME", () => {
  let captured;
  const fake = makeFakeModule();
  fake._cortext_process_text_with_media_json_with_options = (
    _handle,
    _textPtr,
    _sourcePtr,
    mediaPtr,
    optionsPtr
  ) => {
    const readU32 = (ptr) =>
      fake.HEAPU8[ptr] |
      (fake.HEAPU8[ptr + 1] << 8) |
      (fake.HEAPU8[ptr + 2] << 16) |
      (fake.HEAPU8[ptr + 3] << 24);
    const dataPtr = readU32(mediaPtr);
    const size = readU32(mediaPtr + 4);
    const mimetypePtr = readU32(mediaPtr + 8);
    const mimeBytes = [];
    for (let ptr = mimetypePtr; fake.HEAPU8[ptr] !== 0; ptr++) {
      mimeBytes.push(fake.HEAPU8[ptr]);
    }
    captured = {
      bytes: Array.from(fake.HEAPU8.slice(dataPtr, dataPtr + size)),
      mimetype: new TextDecoder().decode(new Uint8Array(mimeBytes)),
      includeEmbedding: readU32(optionsPtr + 4),
      retention: readU32(optionsPtr + 8),
    };
    const resultPtr = fake._malloc(16);
    fake._setString(
      resultPtr,
      JSON.stringify({ consolidation_recommended: true, should_interrupt: false })
    );
    return resultPtr;
  };

  const runtime = new esm.CortextWasm(fake);
  const ctx = runtime.processTextWithMedia(
    1,
    "canonical text",
    "browser",
    {
      data: new Uint8Array([0, 255, 1, 128]).buffer,
      mimetype: "application/octet-stream",
    },
    { includeEmbedding: false, retention: "ephemeral" }
  );

  assert.deepEqual(captured, {
    bytes: [0, 255, 1, 128],
    mimetype: "application/octet-stream",
    includeEmbedding: 0,
    retention: 3,
  });
  assert.equal(ctx.consolidation_state, "recommended");
  assert.equal(ctx.should_interrupt, false);
});

test("CortextWasm processTextWithMedia validates retention before allocation", () => {
  const runtime = new esm.CortextWasm(makeFakeModule({ _malloc: () => 0 }));
  assert.throws(
    () =>
      runtime.processTextWithMedia(
        1,
        "text",
        "source",
        { data: new Uint8Array([1]), mimetype: "application/octet-stream" },
        { retention: "invalid" }
      ),
    /retention must be/
  );
});

test("validateImageBuffer rejects oversize dimensions", () => {
  assert.throws(
    () => esm.validateImageBuffer(new Uint8Array(1), 0x80000000, 1, 1),
    /native int range|positive integers|overflow/
  );
});

test("PACKAGE_VERSION and ENGINE_VERSION_TARGET are exported", () => {
  assert.equal(esm.PACKAGE_VERSION, "2.0.0");
  assert.equal(esm.ENGINE_VERSION_TARGET, "2.0.0");
});

test("referenceTimeValue maps unset, numbers, and Dates", () => {
  assert.deepEqual(esm.referenceTimeValue(), {
    hasReferenceMs: 0,
    referenceMs: 0,
    asOf: 0,
  });
  assert.deepEqual(esm.referenceTimeValue(1_700_000_000_000), {
    hasReferenceMs: 1,
    referenceMs: 1_700_000_000_000,
    asOf: 0,
  });
  assert.deepEqual(esm.referenceTimeValue(new Date(1_700_000_000_000), true), {
    hasReferenceMs: 1,
    referenceMs: 1_700_000_000_000,
    asOf: 1,
  });
  assert.deepEqual(esm.referenceTimeValue(0, true), {
    hasReferenceMs: 1,
    referenceMs: 0,
    asOf: 1,
  });
});

test("referenceTimeValue rejects invalid reference times", () => {
  assert.throws(() => esm.referenceTimeValue(-1), /referenceMs/);
  assert.throws(() => esm.referenceTimeValue(1.5), /referenceMs/);
  assert.throws(() => esm.referenceTimeValue(Number.NaN), /referenceMs/);
  assert.throws(
    () => esm.referenceTimeValue(Number.MAX_SAFE_INTEGER + 1),
    /referenceMs/
  );
  assert.throws(() => esm.referenceTimeValue(new Date(Number.NaN)), /referenceMs/);
  assert.throws(() => esm.referenceTimeValue("2026-01-01"), /referenceMs/);
  assert.throws(() => esm.referenceTimeValue(undefined, true), /asOf/);
});

test("processText passes the reference time to the WASM export", () => {
  const calls = [];
  const fake = makeFakeModule({
    _cortext_wasm_process_text_json: (...args) => {
      calls.push(args);
      const ptr = fake._malloc(16);
      fake._setString(ptr, '{"consolidation_state":"none"}');
      return ptr;
    },
  });
  const wasm = new esm.CortextWasm(fake);
  wasm.processText(1, "q", "query", {
    retention: "ephemeral",
    referenceMs: 1_700_000_000_000,
  });
  wasm.processText(1, "q", "query", {
    retention: "ephemeral",
    referenceMs: new Date(1_600_000_000_000),
    asOf: true,
    evidenceBudgetBytes: 2_000,
  });
  assert.deepEqual(calls[0].slice(3), [1, 3, 0, 1, 1_700_000_000_000, 0]);
  assert.deepEqual(calls[1].slice(3), [1, 3, 2_000, 1, 1_600_000_000_000, 1]);
});

test("processText validates the reference time before allocation", () => {
  const runtime = new esm.CortextWasm(
    makeFakeModule({
      _malloc: () => {
        throw new Error("WASM allocation should not be attempted");
      },
    })
  );
  assert.throws(
    () => runtime.processText(1, "q", "s", { referenceMs: -5 }),
    /referenceMs/
  );
  assert.throws(
    () => runtime.processText(1, "q", "s", { asOf: true }),
    /asOf/
  );
});

function readU32(heap, ptr) {
  return (
    (heap[ptr] |
      (heap[ptr + 1] << 8) |
      (heap[ptr + 2] << 16) |
      (heap[ptr + 3] << 24)) >>>
    0
  );
}

test("processTextWithMedia writes the full v5 process options layout", () => {
  let options;
  let mediaPtrSeen;
  const fake = makeFakeModule();
  fake._cortext_process_text_with_media_json_with_options = (
    _handle,
    _textPtr,
    _sourcePtr,
    mediaPtr,
    optionsPtr
  ) => {
    const heap = fake.HEAPU8;
    mediaPtrSeen = mediaPtr;
    options = {
      structSize: readU32(heap, optionsPtr),
      includeEmbedding: readU32(heap, optionsPtr + 4),
      retention: readU32(heap, optionsPtr + 8),
      reserved: readU32(heap, optionsPtr + 12),
      evidenceBudgetBytes: readU32(heap, optionsPtr + 16),
      hasReferenceMs: readU32(heap, optionsPtr + 20),
      asOf: readU32(heap, optionsPtr + 24),
      referenceMs:
        readU32(heap, optionsPtr + 32) +
        readU32(heap, optionsPtr + 36) * 2 ** 32,
    };
    const ptr = fake._malloc(16);
    fake._setString(ptr, '{"consolidation_state":"none"}');
    return ptr;
  };
  const runtime = new esm.CortextWasm(fake);
  runtime.processTextWithMedia(1, "q", "query", null, {
    includeEmbedding: false,
    retention: "ephemeral",
    evidenceBudgetBytes: 34_800,
    referenceMs: 1_700_000_000_123,
    asOf: true,
  });
  assert.equal(mediaPtrSeen, 0);
  assert.deepEqual(options, {
    structSize: 40,
    includeEmbedding: 0,
    retention: 3,
    reserved: 0,
    evidenceBudgetBytes: 34_800,
    hasReferenceMs: 1,
    asOf: 1,
    referenceMs: 1_700_000_000_123,
  });

  runtime.processTextWithMedia(1, "stored", "user", {
    data: new Uint8Array([1, 2]),
    mimetype: "image/png",
  });
  assert.notEqual(mediaPtrSeen, 0);
  assert.deepEqual(
    {
      evidenceBudgetBytes: options.evidenceBudgetBytes,
      hasReferenceMs: options.hasReferenceMs,
      asOf: options.asOf,
      referenceMs: options.referenceMs,
      retention: options.retention,
      includeEmbedding: options.includeEmbedding,
    },
    {
      evidenceBudgetBytes: 0,
      hasReferenceMs: 0,
      asOf: 0,
      referenceMs: 0,
      retention: 0,
      includeEmbedding: 1,
    }
  );
});

test("processTextWithMedia validates budget and reference time before allocation", () => {
  const runtime = new esm.CortextWasm(
    makeFakeModule({
      _malloc: () => {
        throw new Error("WASM allocation should not be attempted");
      },
    })
  );
  assert.throws(
    () =>
      runtime.processTextWithMedia(1, "q", "s", null, {
        evidenceBudgetBytes: -1,
      }),
    /evidenceBudgetBytes/
  );
  assert.throws(
    () => runtime.processTextWithMedia(1, "q", "s", null, { asOf: true }),
    /asOf/
  );
});

test("writeLateInteractionModelFile places the LI reranker beside AIST", async () => {
  const writes = [];
  const runtime = new esm.CortextWasm(
    makeFakeModule({
      FS: {
        mkdir() {},
        writeFile: (p, bytes) => writes.push([p, bytes.length]),
      },
    })
  );
  const aist = await runtime.writeModelFile(new Uint8Array(3));
  const li = await runtime.writeLateInteractionModelFile(new Uint8Array(5));
  assert.equal(aist, "/models/AIST-87M-GGUF/AIST-87M_q8_0.gguf");
  assert.equal(li, "/models/AIST-87M-GGUF/AIST-87M-LI.gguf");
  assert.equal(esm.AIST_MODEL_PATH, aist);
  assert.equal(esm.LI_MODEL_PATH, li);
  assert.deepEqual(writes, [
    [aist, 3],
    [li, 5],
  ]);
});

test("mkdirp tolerates Emscripten EEXIST by errno and by code", () => {
  const made = new Set();
  const mkdir = (style) => (p) => {
    if (made.has(p)) {
      throw style === "errno"
        ? Object.assign(new Error("FS error"), { name: "ErrnoError", errno: 20 })
        : Object.assign(new Error("FS error"), { code: "EEXIST" });
    }
    made.add(p);
  };
  for (const style of ["errno", "code"]) {
    made.clear();
    const runtime = new esm.CortextWasm(
      makeFakeModule({ FS: { mkdir: mkdir(style), writeFile() {} } })
    );
    runtime.writeFile("/models/AIST-87M-GGUF/a.gguf", new Uint8Array(1));
    runtime.writeFile("/models/AIST-87M-GGUF/b.gguf", new Uint8Array(1));
  }
  const runtime = new esm.CortextWasm(
    makeFakeModule({
      FS: {
        mkdir() {
          throw Object.assign(new Error("FS error"), { errno: 44 });
        },
        writeFile() {},
      },
    })
  );
  assert.throws(() => runtime.mkdirp("/x"), /FS error/);
});

test("writeTokenizerVocabFile places vocab.txt in the engine model tree", async () => {
  const writes = [];
  const runtime = new esm.CortextWasm(
    makeFakeModule({
      FS: { mkdir() {}, writeFile: (p) => writes.push(p) },
    })
  );
  assert.equal(
    await runtime.writeTokenizerVocabFile(new Uint8Array(2)),
    "/models/mdbr-leaf-ir/vocab.txt"
  );
  assert.equal(esm.VOCAB_PATH, "/models/mdbr-leaf-ir/vocab.txt");
  assert.deepEqual(writes, ["/models/mdbr-leaf-ir/vocab.txt"]);
});
