# Changelog

All notable changes to `@augmem/cortext-wasm` (this repository: **cortext.wasm**)
are documented here.

The format is based on [Keep a Changelog](https://keepachangelog.com/en/1.1.0/),
and this project aims to follow [Semantic Versioning](https://semver.org/).

## [2.0.0] - 2026-10-20

Requires Cortext engine **v2.0.0** (`ENGINE_VERSION`): the C ABI and the WASM
process export changed. Tracks engine v5, per-blob content timestamps and
reference-time retrieval. The binding version now follows the engine major.

### Breaking

- `CortextConfig.proceduralEnabled` and the Soft Anchors types
  (`soft_anchors`) are removed; the engine dropped both.
- The engine no longer trims each memory to 3 KiB: recalled memories come back
  whole unless `evidenceBudgetBytes` is set.
- The engine requires the late-interaction reranker `AIST-87M-LI.gguf` beside
  the AIST model: `createContext` throws without it. Load it with
  `writeLateInteractionModelFile`, or include it in the
  `CORTEXT_WASM_PRELOAD_MODEL_ASSETS_DIR` tree.
- `_cortext_wasm_process_text_json` takes the evidence budget and the trailing
  `hasReferenceMs`, `referenceMs` and `asOf` arguments (cortext.cpp
  `src/wasm/module.cpp`); older WASM assets do not match this wrapper.
- `processTextWithMedia` writes the 40-byte v5 `cortext_process_json_options`
  layout (evidence budget and reference time), which older engines reject.

### Added

- `ProcessOptions.evidenceBudgetBytes` (and `evidenceBudgetValue`): per-call
  evidence budget in bytes; non-text payloads count 480 bytes each.
- `CortextContext.standing_memory`: standing directives, returned outside the
  retrieved top-k.
- `CortextMemoryContent`: every payload of a memory with its own `mimetype`,
  `base64` bytes and `timestamp` (ms; 0 = unknown). `modality` may be
  `"mixed"`; `mimetype` is the first signal's.
- `ProcessOptions.referenceMs` (`Date` or ms since the epoch) and `asOf`
  (and `referenceTimeValue`): query reference time; `asOf` hides memories
  stored after it. Read by `"ephemeral"` calls only.
- `CortextWasm.processTextWithMedia(handle, text, sourceId, media, options)`:
  canonical text plus caller media bytes and MIME type (folds in PR #1), with
  the same options as `processText`. `null` or empty media stores the text;
  a `text/*` MIME type counts as text.
- `CortextWasm.writeLateInteractionModelFile` and
  `CortextWasm.writeTokenizerVocabFile`, plus the `AIST_MODEL_DIR`,
  `AIST_MODEL_PATH`, `LI_MODEL_FILENAME`, `LI_MODEL_PATH` and `VOCAB_PATH`
  virtual-FS constants.
- `vendor:wasm` copies `cortext.data` from a preload build for local use;
  `check:wasm` rejects preload builds before publish (model files never ship).
- `scripts/assemble-models.mjs`: reassemble and checksum the AIST, LI and
  vocab runtime files from an engine `models/` tree (checkout or release
  tarball) against its `manifest.json`.
- `tests/engine.test.mjs`: live-engine tests driven by
  `CORTEXT_AIST_MODEL_PATH`, `CORTEXT_LI_MODEL_PATH`, `CORTEXT_VOCAB_PATH` and
  `CORTEXT_WASM_PRELOAD_DIST`; skipped without them unless
  `CORTEXT_WASM_REQUIRE_ENGINE=1`.
- CI `engine-wasm` job: builds the WASM from the `ENGINE_VERSION` tag of
  cortext.cpp, assembles the models from that release's asset tarball, and
  runs the live tests with `CORTEXT_WASM_REQUIRE_ENGINE=1`.

### Fixed

- `mkdirp` treats current Emscripten `ErrnoError` (numeric `errno` 20) as
  EEXIST, so writing a second model file into the same directory works.

## [1.2.4] - 2026-07-24

### Fixed (review r1)

- Honest engine-line pin via `ENGINE_VERSION` / `ENGINE_VERSION_TARGET` (vendored
  binary may still report an older `version()` until rebuild).
- Strengthened `check-wasm` (size + WASM magic; reject absolute `.vendor-source`).
- Package exports for `cortext.wasm` assets; class-level `processText`
  normalization test; image overflow test; `prepublishOnly` runs unit tests.
- README locateFile example uses package export resolution.

### Added

- Standalone **cortext.wasm** repository for browser WebAssembly bindings.
- Dual-package publish layout: ESM (browser-first) + CJS + `.d.ts`.
- TypeScript port of monorepo `bindings/wasm/cortext.js` as `CortextWasm`.
- Pure helpers: `normalizeContext` (legacy boolean → `consolidation_state`),
  `retentionValue`, `validateImageBuffer`.
- `npm run vendor:wasm` / `check:wasm` for Emscripten artifact staging.
- Unit tests via `node:test` (no WASM required).
- Optional smoke test when `assets/cortext.{js,wasm}` are present.
- CI workflow (typecheck + unit tests; WASM smoke optional).

### Notes

- Binding version **1.2.4** tracks Cortext engine **v1.2.4**.
- Package name is **`@augmem/cortext-wasm`** (does not collide with Node
  N-API package `@augmem/cortext` from cortext.ts).
- Continuity: API surface mirrors monorepo `bindings/wasm` with typed
  improvements and consolidation_state normalization matching other bindings.
