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
  assert.equal(esm.PACKAGE_VERSION, "1.2.4");
});

function makeFakeModule(overrides = {}) {
  let nextPtr = 16;
  const strings = new Map();
  return {
    FS: { mkdir() {}, writeFile() {} },
    HEAPU8: new Uint8Array(4096),
    HEAPF32: new Float32Array(1024),
    _malloc: (n) => {
      const ptr = nextPtr;
      nextPtr += Math.max(n, 8);
      return ptr;
    },
    _free() {},
    lengthBytesUTF8: (s) => Buffer.byteLength(s, "utf8"),
    stringToUTF8() {},
    UTF8ToString: (ptr) => strings.get(ptr) ?? "",
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
    ...overrides,
  };
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

test("validateImageBuffer rejects oversize dimensions", () => {
  assert.throws(
    () => esm.validateImageBuffer(new Uint8Array(1), 0x80000000, 1, 1),
    /native int range|positive integers|overflow/
  );
});

test("PACKAGE_VERSION and ENGINE_VERSION_TARGET are exported", () => {
  assert.equal(esm.PACKAGE_VERSION, "1.2.4");
  assert.equal(esm.ENGINE_VERSION_TARGET, "1.2.4");
});
