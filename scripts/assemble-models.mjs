#!/usr/bin/env node
/**
 * Assemble the engine's runtime model tree from its Git-chunked model assets.
 *
 * Input: a cortext.cpp `models/` directory (a checkout, or `models/` from the
 * release tarball `cortext-assets-<version>.tar.gz`) holding `manifest.json`,
 * the `AIST-87M-GGUF/chunks/*.part-*` shards and `mdbr-leaf-ir/vocab.txt`.
 *
 * Output: the tree the WASM engine reads at `/models` (write it into the VFS
 * with the CortextWasm write*File helpers, or preload it with
 * -DCORTEXT_WASM_PRELOAD_MODEL_ASSETS_DIR):
 *
 *   <out>/AIST-87M-GGUF/AIST-87M_q8_0.gguf
 *   <out>/AIST-87M-GGUF/AIST-87M-LI.gguf
 *   <out>/mdbr-leaf-ir/vocab.txt
 *
 * Every asset is checked against the manifest's sha256 (and size when listed).
 * Shards are concatenated in manifest order; they are never re-sharded.
 *
 * Usage: node scripts/assemble-models.mjs <models-dir> <out-dir>
 */
import crypto from "node:crypto";
import fs from "node:fs";
import path from "node:path";

const [sourceArg, outArg] = process.argv.slice(2);
if (!sourceArg || !outArg) {
  console.error("Usage: node scripts/assemble-models.mjs <models-dir> <out-dir>");
  process.exit(2);
}
const source = path.resolve(sourceArg);
const out = path.resolve(outArg);

/** Runtime files the WASM engine needs (manifest filenames). */
const REQUIRED = [
  "AIST-87M-GGUF/AIST-87M_q8_0.gguf",
  "AIST-87M-GGUF/AIST-87M-LI.gguf",
  "mdbr-leaf-ir/vocab.txt",
];

const manifest = JSON.parse(
  fs.readFileSync(path.join(source, "manifest.json"), "utf8")
);
const assets = new Map(manifest.assets.map((a) => [a.filename, a]));

function sha256(bytes) {
  return crypto.createHash("sha256").update(bytes).digest("hex");
}

for (const filename of REQUIRED) {
  const asset = assets.get(filename);
  if (!asset) {
    throw new Error(`manifest.json has no asset ${filename}`);
  }
  const parts = asset.chunks?.length
    ? asset.chunks.map((chunk) => {
        const bytes = fs.readFileSync(path.join(source, chunk.filename));
        if (chunk.sha256 && sha256(bytes) !== chunk.sha256) {
          throw new Error(`checksum mismatch: ${chunk.filename}`);
        }
        return bytes;
      })
    : [fs.readFileSync(path.join(source, filename))];
  const bytes = Buffer.concat(parts);
  if (asset.size !== undefined && bytes.length !== asset.size) {
    throw new Error(
      `size mismatch: ${filename} is ${bytes.length} bytes, manifest ${asset.size}`
    );
  }
  if (sha256(bytes) !== asset.sha256) {
    throw new Error(`checksum mismatch: ${filename}`);
  }
  const dest = path.join(out, filename);
  fs.mkdirSync(path.dirname(dest), { recursive: true });
  fs.writeFileSync(dest, bytes);
  console.log(`ok ${filename} (${bytes.length} bytes, sha256 ${asset.sha256})`);
}
console.log(
  `assembled models for engine ${manifest.cortext_version ?? "unknown"} in ${out}`
);
