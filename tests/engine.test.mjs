// Live-engine tests: the vendored WASM build plus the AIST and LI model files.
//
// Needs assets/cortext.{js,wasm} (npm run vendor:wasm) and the models, found
// through CORTEXT_AIST_MODEL_PATH and CORTEXT_LI_MODEL_PATH (host paths read
// by Node and written into the Emscripten virtual FS). Skips otherwise.
//
// CORTEXT_WASM_REQUIRE_ENGINE=1 (CI) turns those skips into failures, so the
// live tests must run.
//
// CORTEXT_WASM_PRELOAD_DIST: optional directory of a build configured with
// -DCORTEXT_WASM_PRELOAD_MODEL_ASSETS_DIR (cortext.js, cortext.wasm and
// cortext.data); exercises the preloaded /models tree.
import assert from "node:assert/strict";
import fs from "node:fs";
import path from "node:path";
import { fileURLToPath, pathToFileURL } from "node:url";
import test from "node:test";

const root = path.resolve(path.dirname(fileURLToPath(import.meta.url)), "..");
const assetsDir = path.join(root, "assets");
const aistPath = process.env.CORTEXT_AIST_MODEL_PATH ?? "";
const liPath = process.env.CORTEXT_LI_MODEL_PATH ?? "";
// The tokenizer vocabulary sits at <models>/mdbr-leaf-ir/vocab.txt, beside
// the AIST-87M-GGUF directory; CORTEXT_VOCAB_PATH overrides.
const vocabPath =
  process.env.CORTEXT_VOCAB_PATH ??
  (aistPath
    ? path.join(path.dirname(path.dirname(aistPath)), "mdbr-leaf-ir", "vocab.txt")
    : "");
const preloadDist = process.env.CORTEXT_WASM_PRELOAD_DIST ?? "";

const hasAssets =
  fs.existsSync(path.join(assetsDir, "cortext.js")) &&
  fs.existsSync(path.join(assetsDir, "cortext.wasm"));
const hasModels =
  aistPath !== "" &&
  liPath !== "" &&
  fs.existsSync(aistPath) &&
  fs.existsSync(liPath) &&
  fs.existsSync(vocabPath);
const requireEngine = process.env.CORTEXT_WASM_REQUIRE_ENGINE === "1";
const skip = !hasAssets || !hasModels;

if (requireEngine) {
  test("CORTEXT_WASM_REQUIRE_ENGINE: live engine assets and models are present", () => {
    assert.ok(hasAssets, "assets/cortext.{js,wasm} missing (npm run vendor:wasm)");
    assert.ok(
      hasModels,
      `models missing: AIST=${aistPath} LI=${liPath} vocab=${vocabPath}`
    );
  });
}

// The Emscripten glue targets web and worker; its OPFS probe reads `self`.
globalThis.self ??= globalThis;

const { CortextWasm, AIST_MODEL_PATH, LI_MODEL_PATH, VOCAB_PATH } = await import(
  pathToFileURL(path.join(root, "dist", "esm", "index.js")).href
);

async function loadRuntime(dir = assetsDir, options = {}) {
  const { default: factory } = await import(
    pathToFileURL(path.join(dir, "cortext.js")).href + `?t=${Math.random()}`
  );
  return CortextWasm.create(factory, {
    wasmBinary: fs.readFileSync(path.join(dir, "cortext.wasm")),
    ...options,
  });
}

let aistBytes;
let liBytes;
let vocabBytes;
function modelBytes() {
  aistBytes ??= fs.readFileSync(aistPath);
  liBytes ??= fs.readFileSync(liPath);
  vocabBytes ??= fs.readFileSync(vocabPath);
  return { aistBytes, liBytes, vocabBytes };
}

async function runtimeWithModels() {
  const runtime = await loadRuntime();
  const { aistBytes: aist, liBytes: li, vocabBytes: vocab } = modelBytes();
  await runtime.writeModelFile(aist);
  await runtime.writeLateInteractionModelFile(li);
  await runtime.writeTokenizerVocabFile(vocab);
  return runtime;
}

function withContext(runtime, fn) {
  const handle = runtime.createContext({ dbPath: ":memory:" });
  try {
    return fn(handle);
  } finally {
    runtime.freeContext(handle);
  }
}

const QUERY = { includeEmbedding: false, retention: "ephemeral" };
const STORE = { includeEmbedding: false, retention: "durable" };

function allMemories(ctx) {
  return [...(ctx.standing_memory ?? []), ...(ctx.retrieved_memory ?? [])];
}

function decodedText(memory) {
  return (memory.content ?? [])
    .filter((c) => c.mimetype.startsWith("text/"))
    .map((c) => Buffer.from(c.base64, "base64").toString("utf8"))
    .join("");
}

function evidenceBytes(ctx) {
  let total = 0;
  for (const memory of allMemories(ctx)) {
    for (const c of memory.content ?? []) {
      total += c.mimetype.startsWith("text/") ? c.size_bytes : 480;
    }
  }
  return total;
}

test("LI asset: createContext needs the reranker beside AIST", { skip }, async () => {
  const runtime = await loadRuntime();
  const { aistBytes: aist, liBytes: li, vocabBytes: vocab } = modelBytes();
  assert.equal(await runtime.writeTokenizerVocabFile(vocab), VOCAB_PATH);
  assert.equal(await runtime.writeModelFile(aist), AIST_MODEL_PATH);
  assert.throws(
    () => runtime.createContext({ dbPath: ":memory:" }),
    /AIST-87M-LI\.gguf/
  );
  assert.match(runtime.lastError(), /AIST-87M-LI\.gguf/);
  assert.equal(await runtime.writeLateInteractionModelFile(li), LI_MODEL_PATH);
  withContext(runtime, (handle) => assert.ok(handle));
});

test("per-content timestamps, mimetypes and standing memory", { skip }, async () => {
  const runtime = await runtimeWithModels();
  withContext(runtime, (handle) => {
    const before = Date.now();
    runtime.processText(handle, "The garage door code is 8841.", "user", STORE);
    runtime.processText(handle, "Always answer in French.", "user", STORE);
    runtime.flush(handle);
    const ctx = runtime.processText(
      handle,
      "What is the garage door code?",
      "query",
      QUERY
    );
    assert.ok(Array.isArray(ctx.standing_memory), "standing_memory block");
    const garage = allMemories(ctx).find((m) =>
      decodedText(m).includes("8841")
    );
    assert.ok(garage, "the stored fact is recalled");
    assert.equal(garage.modality, "text");
    for (const c of garage.content) {
      assert.equal(c.mimetype, "text/plain");
      assert.equal(typeof c.timestamp, "number");
      assert.ok(c.timestamp >= before - 1000, `timestamp ${c.timestamp}`);
    }
    const french = ctx.standing_memory.find((m) =>
      decodedText(m).includes("French")
    );
    assert.ok(french, "the directive is in standing_memory");
  });
});

test("evidence budget trims the returned packet", { skip }, async () => {
  const runtime = await runtimeWithModels();
  withContext(runtime, (handle) => {
    const entries = Array.from(
      { length: 8 },
      (_, i) => `Harbor log ${i}: the ferry left pier ${i} at dawn with ${i} crates.`
    );
    for (const entry of entries) {
      runtime.processText(handle, entry, "user", STORE);
    }
    runtime.flush(handle);
    const whole = runtime.processText(handle, "When did the ferry leave?", "q", QUERY);
    const budget = 200;
    assert.ok(
      evidenceBytes(whole) > budget,
      `unbudgeted packet ${evidenceBytes(whole)} bytes should exceed ${budget}`
    );
    const trimmed = runtime.processText(handle, "When did the ferry leave?", "q", {
      ...QUERY,
      evidenceBudgetBytes: budget,
    });
    assert.ok(allMemories(trimmed).length > 0, "something fits the budget");
    assert.ok(
      evidenceBytes(trimmed) <= budget,
      `packet ${evidenceBytes(trimmed)} bytes over ${budget}`
    );
  });
});

test("reference time with and without asOf", { skip }, async () => {
  const runtime = await runtimeWithModels();
  withContext(runtime, (handle) => {
    runtime.processText(handle, "The lighthouse keeper is named Ostrander.", "user", STORE);
    runtime.flush(handle);
    const question = "Who is the lighthouse keeper?";
    const found = (ctx) =>
      allMemories(ctx).some((m) => decodedText(m).includes("Ostrander"));
    const past = new Date(Date.now() - 365 * 24 * 3600 * 1000);

    assert.ok(found(runtime.processText(handle, question, "q", QUERY)));
    assert.ok(
      found(runtime.processText(handle, question, "q", { ...QUERY, referenceMs: past })),
      "a reference time alone does not hide later memories"
    );
    assert.ok(
      !found(
        runtime.processText(handle, question, "q", {
          ...QUERY,
          referenceMs: past,
          asOf: true,
        })
      ),
      "asOf hides memories stored after the reference time"
    );
    assert.ok(
      found(
        runtime.processText(handle, question, "q", {
          ...QUERY,
          referenceMs: Date.now() + 60_000,
          asOf: true,
        })
      ),
      "asOf after the store keeps the memory"
    );
  });
});

test("processTextWithMedia stores caller media in place of the text", { skip }, async () => {
  const runtime = await runtimeWithModels();
  withContext(runtime, (handle) => {
    const png = new Uint8Array([0x89, 0x50, 0x4e, 0x47, 0, 255, 1, 128]);
    runtime.processTextWithMedia(
      handle,
      "A photo of the red barn at the north field.",
      "camera",
      { data: png, mimetype: "image/png" },
      STORE
    );
    runtime.processTextWithMedia(
      handle,
      "The blue canoe is stored in the boathouse.",
      "user",
      { data: new Uint8Array(0), mimetype: "image/png" },
      STORE
    );
    runtime.flush(handle);

    const barn = runtime.processTextWithMedia(
      handle,
      "Where is the red barn?",
      "q",
      null,
      { ...QUERY, evidenceBudgetBytes: 34_800 }
    );
    const media = allMemories(barn)
      .flatMap((m) => m.content ?? [])
      .find((c) => c.mimetype === "image/png");
    assert.ok(media, "the PNG payload is recalled");
    assert.deepEqual(
      [...Buffer.from(media.base64, "base64")],
      [...png],
      "bytes round-trip unchanged"
    );
    assert.ok(media.timestamp > 0);

    const canoe = runtime.processText(handle, "Where is the blue canoe?", "q", QUERY);
    const stored = allMemories(canoe).find((m) =>
      decodedText(m).includes("blue canoe")
    );
    assert.ok(stored, "empty media stores the canonical text");
  });
});

test(
  "preloaded /models tree resolves AIST and LI without writeModelFile",
  { skip: skip || preloadDist === "" },
  async () => {
    const data = fs.readFileSync(path.join(preloadDist, "cortext.data"));
    const runtime = await loadRuntime(preloadDist, {
      getPreloadedPackage: () =>
        data.buffer.slice(data.byteOffset, data.byteOffset + data.byteLength),
    });
    withContext(runtime, (handle) => {
      runtime.processText(handle, "The attic key hangs by the stove.", "user", STORE);
      runtime.flush(handle);
      const ctx = runtime.processText(handle, "Where is the attic key?", "q", QUERY);
      assert.ok(allMemories(ctx).some((m) => decodedText(m).includes("attic key")));
    });
  }
);
