#!/usr/bin/env node
/**
 * Mark dist/esm as an ES module tree for dual-package consumers.
 */
import fs from "node:fs";
import path from "node:path";
import { fileURLToPath } from "node:url";

const root = path.resolve(path.dirname(fileURLToPath(import.meta.url)), "..");
const outDir = path.join(root, "dist", "esm");
fs.mkdirSync(outDir, { recursive: true });
fs.writeFileSync(
  path.join(outDir, "package.json"),
  JSON.stringify({ type: "module" }, null, 2) + "\n"
);
