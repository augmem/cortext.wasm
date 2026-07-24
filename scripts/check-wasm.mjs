#!/usr/bin/env node
/**
 * Verify vendored Emscripten assets exist before publish.
 *
 * Flags:
 *   --optional   exit 0 with a warning when missing (CI unit-only path)
 */
import fs from "node:fs";
import path from "node:path";
import { fileURLToPath } from "node:url";

const root = path.resolve(path.dirname(fileURLToPath(import.meta.url)), "..");
const optional = process.argv.includes("--optional");

const required = ["cortext.js", "cortext.wasm"];
const missing = required.filter(
  (name) => !fs.existsSync(path.join(root, "assets", name))
);

if (missing.length === 0) {
  for (const name of required) {
    const st = fs.statSync(path.join(root, "assets", name));
    console.log(`ok assets/${name} (${st.size} bytes)`);
  }
  process.exit(0);
}

const msg =
  `Missing vendored WASM assets: ${missing.join(", ")}\n` +
  `Run: npm run vendor:wasm\n` +
  `(after building engine monorepo with ./build-wasm.sh)`;

if (optional) {
  console.warn(msg);
  process.exit(0);
}

console.error(msg);
process.exit(1);
