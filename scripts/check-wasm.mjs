#!/usr/bin/env node
/**
 * Verify vendored Emscripten assets before publish.
 *
 * Flags:
 *   --optional   exit 0 with a warning when missing (CI unit-only path)
 */
import fs from "node:fs";
import path from "node:path";
import { fileURLToPath } from "node:url";

const root = path.resolve(path.dirname(fileURLToPath(import.meta.url)), "..");
const optional = process.argv.includes("--optional");
const assetsDir = path.join(root, "assets");

const MIN_JS_BYTES = 1024;
const MIN_WASM_BYTES = 1024;
// WASM magic: \0asm
const WASM_MAGIC = Buffer.from([0x00, 0x61, 0x73, 0x6d]);

function fail(msg) {
  if (optional) {
    console.warn(msg);
    process.exit(0);
  }
  console.error(msg);
  process.exit(1);
}

// Reject absolute local provenance that must not ship.
const vendorSource = path.join(assetsDir, ".vendor-source");
if (fs.existsSync(vendorSource)) {
  const text = fs.readFileSync(vendorSource, "utf8");
  if (text.includes("/Users/") || text.includes("/home/") || /^[A-Za-z]:\\/.test(text)) {
    fail(
      "assets/.vendor-source contains absolute local paths; rewrite to relative " +
        "engine version / git sha provenance only, or delete before publish."
    );
  }
}

const required = [
  { name: "cortext.js", min: MIN_JS_BYTES },
  { name: "cortext.wasm", min: MIN_WASM_BYTES },
];

const missing = required.filter(
  (item) => !fs.existsSync(path.join(assetsDir, item.name))
);
if (missing.length) {
  fail(
    `Missing vendored WASM assets: ${missing.map((m) => m.name).join(", ")}\n` +
      `Run: npm run vendor:wasm\n` +
      `(after building engine monorepo with ./build-wasm.sh)`
  );
}

for (const item of required) {
  const file = path.join(assetsDir, item.name);
  const st = fs.statSync(file);
  if (st.size < item.min) {
    fail(`assets/${item.name} is too small (${st.size} bytes; min ${item.min})`);
  }
  if (item.name.endsWith(".wasm")) {
    const fd = fs.openSync(file, "r");
    const buf = Buffer.alloc(4);
    fs.readSync(fd, buf, 0, 4, 0);
    fs.closeSync(fd);
    if (!buf.equals(WASM_MAGIC)) {
      fail(`assets/${item.name} is not a valid WASM module (bad magic)`);
    }
  }
  if (item.name.endsWith(".js")) {
    const head = fs.readFileSync(file, "utf8").slice(0, 200);
    if (!head.includes("createCortextModule") && !head.includes("Module")) {
      // Soft signal only — emscripten glue varies.
      console.warn(
        `warning: assets/${item.name} does not look like Emscripten glue (first 200 chars)`
      );
    }
  }
  console.log(`ok assets/${item.name} (${st.size} bytes)`);
}

// Optional: load module in Node and print engine version (does not fail pin mismatch —
// document ENGINE_VERSION separately; warn if present).
const pinPath = path.join(root, "ENGINE_VERSION");
if (fs.existsSync(pinPath)) {
  const pin = fs.readFileSync(pinPath, "utf8").trim();
  console.log(`binding expects engine line: ${pin} (see ENGINE_VERSION / README)`);
}

process.exit(0);
