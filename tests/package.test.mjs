import assert from "node:assert/strict";
import { createRequire } from "node:module";
import fs from "node:fs";
import path from "node:path";
import { fileURLToPath, pathToFileURL } from "node:url";
import test from "node:test";

const root = path.resolve(path.dirname(fileURLToPath(import.meta.url)), "..");
const require = createRequire(import.meta.url);

test("package.json follows dual-package publish conventions", () => {
  const pkg = JSON.parse(
    fs.readFileSync(path.join(root, "package.json"), "utf8")
  );

  assert.equal(pkg.name, "@augmem/cortext-wasm");
  assert.equal(pkg.version, "1.2.4");
  assert.equal(pkg.license, "Apache-2.0");
  assert.ok(pkg.engines?.node);
  assert.equal(pkg.publishConfig?.access, "public");
  assert.ok(pkg.files.includes("dist/**/*"));
  assert.ok(
    pkg.files.includes("assets/**/*") ||
      (pkg.files.includes("assets/cortext.js") &&
        pkg.files.includes("assets/cortext.wasm"))
  );
  assert.ok(pkg.files.includes("ENGINE_VERSION"));
  assert.ok(pkg.repository?.url?.includes("cortext.wasm"));
  assert.ok(pkg.scripts?.prepublishOnly);
  assert.match(pkg.scripts.prepublishOnly, /test:unit/);
  assert.ok(pkg.scripts?.build);
  assert.equal(pkg.main, "./dist/cjs/index.js");
  assert.equal(pkg.module, "./dist/esm/index.js");
  assert.equal(pkg.types, "./dist/types/index.d.ts");
  assert.ok(pkg.exports["."].import);
  assert.ok(pkg.exports["."].require);
  assert.ok(pkg.exports["."].types);
  assert.ok(pkg.exports["./module"]);
  assert.ok(pkg.exports["./cortext.wasm"]);
});

test("required root files exist", () => {
  for (const rel of [
    "LICENSE",
    "NOTICE",
    "README.md",
    "CHANGELOG.md",
    "package.json",
    "tsconfig.json",
    "src/index.ts",
    "src/cortext-wasm.ts",
    "src/types.ts",
    "src/normalize.ts",
    "scripts/vendor-wasm.mjs",
    "scripts/check-wasm.mjs",
  ]) {
    assert.ok(fs.existsSync(path.join(root, rel)), `missing ${rel}`);
  }
});

test("published type declarations match consolidation_state contract", () => {
  const declarations = fs.readFileSync(
    path.join(root, "dist", "types", "types.d.ts"),
    "utf8"
  );
  assert.match(
    declarations,
    /export type ConsolidationState = "none" \| "recommended" \| "required";/
  );
  assert.match(declarations, /consolidation_state: ConsolidationState;/);
  assert.doesNotMatch(declarations, /consolidation_recommended/);
  assert.doesNotMatch(declarations, /consolidation_required/);
});

test("dual package entry points load CortextWasm", async () => {
  assert.ok(fs.existsSync(path.join(root, "dist", "cjs", "index.js")));
  assert.ok(fs.existsSync(path.join(root, "dist", "esm", "index.js")));
  assert.ok(fs.existsSync(path.join(root, "dist", "cjs", "package.json")));
  assert.ok(fs.existsSync(path.join(root, "dist", "esm", "package.json")));

  const cjs = require(path.join(root, "dist", "cjs", "index.js"));
  assert.equal(typeof cjs.CortextWasm, "function");
  assert.equal(typeof cjs.normalizeContext, "function");
  assert.equal(typeof cjs.retentionValue, "function");
  assert.equal(typeof cjs.validateImageBuffer, "function");
  assert.equal(cjs.PACKAGE_VERSION, "1.2.4");

  const esm = await import(
    pathToFileURL(path.join(root, "dist", "esm", "index.js")).href
  );
  assert.equal(typeof esm.CortextWasm, "function");
  assert.equal(esm.PACKAGE_VERSION, "1.2.4");
});

test("package name does not collide with Node N-API package", () => {
  const pkg = JSON.parse(
    fs.readFileSync(path.join(root, "package.json"), "utf8")
  );
  assert.notEqual(pkg.name, "@augmem/cortext");
  assert.equal(pkg.name, "@augmem/cortext-wasm");
});
