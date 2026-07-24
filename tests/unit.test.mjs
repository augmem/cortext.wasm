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

test("CortextWasm processText validates retention without loading WASM", () => {
  const fake = {
    FS: { mkdir() {}, writeFile() {} },
    HEAPU8: new Uint8Array(0),
    HEAPF32: new Float32Array(0),
    _malloc: () => 0,
    _free() {},
    lengthBytesUTF8: () => 0,
    stringToUTF8() {},
    UTF8ToString: () => "",
    _cortext_create: () => 0,
    _cortext_free() {},
    _cortext_reset: () => 0,
    _cortext_flush: () => 0,
    _cortext_consolidate: () => 0,
    _cortext_version: () => 0,
    _cortext_last_error: () => 0,
    _cortext_string_free() {},
    _cortext_embed_text_json: () => 0,
    _cortext_embed_audio_json: () => 0,
    _cortext_embed_image_json: () => 0,
    _cortext_wasm_process_text_json: () => 0,
  };
  const runtime = new esm.CortextWasm(fake);
  assert.throws(
    () => runtime.processText(1, "x", "s", { retention: "nope" }),
    /retention must be/
  );
  assert.throws(
    () => runtime.embedImage(1, new Uint8Array(1), 0, 1, 3),
    /positive integers/
  );
});
