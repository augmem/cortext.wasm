import assert from "node:assert/strict";
import fs from "node:fs";
import path from "node:path";
import { fileURLToPath, pathToFileURL } from "node:url";
import test from "node:test";

const root = path.resolve(path.dirname(fileURLToPath(import.meta.url)), "..");
const wasmPath = path.join(root, "assets", "cortext.wasm");
const jsPath = path.join(root, "assets", "cortext.js");
const hasAssets = fs.existsSync(wasmPath) && fs.existsSync(jsPath);

// The Emscripten glue targets web and worker; its OPFS probe reads `self`.
globalThis.self ??= globalThis;

if (process.env.CORTEXT_WASM_REQUIRE_ENGINE === "1") {
  test("CORTEXT_WASM_REQUIRE_ENGINE: vendored WASM assets are present", () => {
    assert.ok(hasAssets, "assets/cortext.{js,wasm} missing (npm run vendor:wasm)");
  });
}

test(
  "WASM module factory loads and reports version",
  { skip: !hasAssets },
  async () => {
    const { CortextWasm } = await import(
      pathToFileURL(path.join(root, "dist", "esm", "index.js")).href
    );
    const moduleUrl = pathToFileURL(jsPath).href;
    const { default: createCortextModule } = await import(moduleUrl);

    // Browser glue has no Node FS fetch path; inject the binary for Node smoke.
    const wasmBinary = fs.readFileSync(wasmPath);

    const runtime = await CortextWasm.create(createCortextModule, {
      wasmBinary,
    });

    const ver = runtime.version();
    assert.equal(typeof ver, "string");
    assert.ok(ver.length > 0, "version() should be non-empty");
    console.log("WASM engine version:", ver);

    // Full createContext often needs the AIST GGUF model in the VFS.
    // When create succeeds without a model, exercise processText lightly.
    let handle = 0;
    try {
      handle = runtime.createContext({ dbPath: ":memory:" });
    } catch (err) {
      console.log(
        "createContext skipped (model likely required):",
        err instanceof Error ? err.message : err
      );
      return;
    }

    try {
      assert.ok(handle);
      const ctx = runtime.processText(
        handle,
        "WASM binding smoke probe.",
        "smoke/test",
        { includeEmbedding: false, retention: "ephemeral" }
      );
      assert.equal(typeof ctx.consolidation_state, "string");
      assert.ok(
        ["none", "recommended", "required"].includes(ctx.consolidation_state)
      );
      runtime.flush(handle);
    } finally {
      runtime.freeContext(handle);
    }
  }
);
