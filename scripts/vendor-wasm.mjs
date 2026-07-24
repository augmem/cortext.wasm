#!/usr/bin/env node
/**
 * Copy Emscripten outputs (cortext.js + cortext.wasm) into assets/.
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
for (const name of ["cortext.js", "cortext.wasm"]) {
  const src = path.join(source, name);
  const dest = path.join(assetsDir, name);
  fs.copyFileSync(src, dest);
  const st = fs.statSync(dest);
  console.log(`copied ${name} (${st.size} bytes) from ${source}`);
}

fs.writeFileSync(
  path.join(assetsDir, ".vendor-source"),
  `${source}\n${new Date().toISOString()}\n`
);
console.log("vendor:wasm complete");
