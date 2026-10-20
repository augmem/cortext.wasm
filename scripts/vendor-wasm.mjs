#!/usr/bin/env node
/**
 * Copy Emscripten outputs (cortext.js + cortext.wasm) into assets/.
 *
 * A build configured with -DCORTEXT_WASM_PRELOAD_MODEL_ASSETS_DIR also emits
 * cortext.data (the preloaded /models tree: AIST, the AIST-87M-LI reranker
 * and the tokenizer vocab). It is copied for local use when present and
 * removed when absent, so assets/ never mixes a stale .data with new glue.
 * check-wasm rejects it before publish: model files never ship on npm.
 *
 * Search order:
 *   1. --from <dir>
 *   2. CORTEXT_WASM_DIST
 *   3. ../cortext/build-wasm/dist/wasm (sibling monorepo checkout)
 *   4. ../../cortext/build-wasm/dist/wasm
 *
 * Usage:
 *   node scripts/vendor-wasm.mjs
 *   node scripts/vendor-wasm.mjs --from /path/to/build-wasm/dist/wasm
 *   node scripts/vendor-wasm.mjs --force
 */
import fs from "node:fs";
import path from "node:path";
import { fileURLToPath } from "node:url";

const root = path.resolve(path.dirname(fileURLToPath(import.meta.url)), "..");
const assetsDir = path.join(root, "assets");

function parseArgs(argv) {
  const out = { from: null, force: false };
  for (let i = 0; i < argv.length; i++) {
    const a = argv[i];
    if (a === "--from") {
      out.from = argv[++i];
    } else if (a === "--force") {
      out.force = true;
    } else if (a === "--help" || a === "-h") {
      console.log(`Usage: node scripts/vendor-wasm.mjs [--from DIR] [--force]`);
      process.exit(0);
    }
  }
  return out;
}

function hasPair(dir) {
  return (
    fs.existsSync(path.join(dir, "cortext.js")) &&
    fs.existsSync(path.join(dir, "cortext.wasm"))
  );
}

function candidateDirs(explicit) {
  const list = [];
  if (explicit) list.push(path.resolve(explicit));
  if (process.env.CORTEXT_WASM_DIST) {
    list.push(path.resolve(process.env.CORTEXT_WASM_DIST));
  }
  list.push(
    path.resolve(root, "../cortext/build-wasm/dist/wasm"),
    path.resolve(root, "../../cortext/build-wasm/dist/wasm")
  );
  return list;
}

const args = parseArgs(process.argv.slice(2));
const existingJs = path.join(assetsDir, "cortext.js");
const existingWasm = path.join(assetsDir, "cortext.wasm");

if (
  !args.force &&
  fs.existsSync(existingJs) &&
  fs.existsSync(existingWasm)
) {
  console.log("assets/ already has cortext.js + cortext.wasm (use --force to overwrite)");
  process.exit(0);
}

let source = null;
for (const dir of candidateDirs(args.from)) {
  if (hasPair(dir)) {
    source = dir;
    break;
  }
}

if (!source) {
  console.error(
    "No cortext.js + cortext.wasm pair found.\n" +
      "Build the engine WASM from a monorepo checkout:\n" +
      "  cd ../cortext && ./build-wasm.sh\n" +
      "Then re-run: npm run vendor:wasm\n" +
      "Or pass: node scripts/vendor-wasm.mjs --from /path/to/build-wasm/dist/wasm"
  );
  process.exit(1);
}

fs.mkdirSync(assetsDir, { recursive: true });
const preloadData = fs.existsSync(path.join(source, "cortext.data"));
const names = ["cortext.js", "cortext.wasm"];
if (preloadData) {
  names.push("cortext.data");
} else {
  fs.rmSync(path.join(assetsDir, "cortext.data"), { force: true });
}
for (const name of names) {
  const src = path.join(source, name);
  const dest = path.join(assetsDir, name);
  fs.copyFileSync(src, dest);
  const st = fs.statSync(dest);
  console.log(`copied ${name} (${st.size} bytes) from ${source}`);
}
if (preloadData) {
  console.warn(
    "warning: preload build (cortext.data holds the /models tree); fine for " +
      "local use, but check:wasm rejects it before publish"
  );
}

// Portable provenance only (no absolute local paths — publish gate rejects them).
const relHint = path.relative(root, source).startsWith("..")
  ? "external-or-sibling-dist"
  : path.relative(root, source);
const enginePin = fs.existsSync(path.join(root, "ENGINE_VERSION"))
  ? fs.readFileSync(path.join(root, "ENGINE_VERSION"), "utf8").trim()
  : "unknown";
fs.writeFileSync(
  path.join(assetsDir, ".vendor-source"),
  [
    `engine_version_target=${enginePin}`,
    `source_kind=${relHint}`,
    `vendored_at=${new Date().toISOString()}`,
    "",
  ].join("\n")
);
console.log("vendor:wasm complete");
