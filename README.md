# cortext.wasm

Browser **WebAssembly** bindings for [Cortext](https://github.com/augmem/cortext).

This repository is the language-binding home for browsers — the sibling of
[`cortext.py`](https://github.com/augmem/cortext.py),
[`cortext.go`](https://github.com/augmem/cortext.go),
[`cortext.ts`](https://github.com/augmem/cortext.ts) (Node N-API), and
[`cortext.dart`](https://github.com/augmem/cortext.dart). It publishes the npm
package **`@augmem/cortext-wasm`**.

> **Not** `@augmem/cortext` — that package is the Node N-API binding in
> [`cortext.ts`](https://github.com/augmem/cortext.ts).

Binding package **2.0.0** targets engine **v2.0.0** (`ENGINE_VERSION`) and
needs it: the C ABI and the `_cortext_wasm_process_text_json` export changed
in engine 2.0.0. The vendored Emscripten binary reports its own identity via
`runtime.version()`; vendor a build from the `v2.0.0` tag of cortext.cpp.

## Install

```bash
npm install @augmem/cortext-wasm
# or
pnpm add @augmem/cortext-wasm
# or
yarn add @augmem/cortext-wasm
```

Browser-first ES module package with TypeScript types. Node.js **18+** is
supported for dual-package consumers and unit tests; the primary target is
modern browsers with WebAssembly.

## Dual package (ESM + CJS)

```json
{
  "main": "./dist/cjs/index.js",
  "module": "./dist/esm/index.js",
  "types": "./dist/types/index.d.ts",
  "exports": {
    ".": {
      "types": "./dist/types/index.d.ts",
      "import": "./dist/esm/index.js",
      "require": "./dist/cjs/index.js"
    },
    "./module": {
      "import": "./assets/cortext.js"
    }
  }
}
```

```ts
// TypeScript / ESM — wrapper API
import { CortextWasm, PACKAGE_VERSION } from "@augmem/cortext-wasm";

// Emscripten factory (vendored assets; required for a live engine)
import createCortextModule from "@augmem/cortext-wasm/module";
```

```js
// CommonJS (wrapper only; load the ES module factory via dynamic import)
const { CortextWasm } = require("@augmem/cortext-wasm");
```

## Quickstart (browser)

```ts
import { CortextWasm } from "@augmem/cortext-wasm";
import createCortextModule from "@augmem/cortext-wasm/module";

// Glue at `@augmem/cortext-wasm/module` resolves `cortext.wasm` as a sibling
// under `assets/` by default. Pin only if your bundler rewrites asset URLs:
const runtime = await CortextWasm.create(createCortextModule, {
  locateFile: (file) =>
    file.endsWith(".wasm")
      ? new URL(
          // package export: `@augmem/cortext-wasm/cortext.wasm`
          import.meta.resolve("@augmem/cortext-wasm/cortext.wasm")
        ).href
      : file,
});

// Load the engine's model files into the Emscripten VFS (or preload them at
// build time, below): the AIST encoder, the late-interaction reranker the
// engine requires beside it, and the tokenizer vocabulary.
const [aist, li, vocab] = document.querySelector<HTMLInputElement>("#models")!.files!;
await runtime.writeModelFile(aist);                // AIST-87M_q8_0.gguf
await runtime.writeLateInteractionModelFile(li);   // AIST-87M-LI.gguf
await runtime.writeTokenizerVocabFile(vocab);      // mdbr-leaf-ir/vocab.txt

const handle = runtime.createContext({
  focus: 0.55,
  sensitivity: 0.5,
  stability: 0.65,
  dbPath: ":memory:",
});

try {
  runtime.processText(handle, "The garage door code is 8841.", "user/profile", {
    includeEmbedding: false,
    retention: "durable",
  });

  // Text remains the canonical embedding input while arbitrary media bytes
  // are persisted with their MIME type (bytes are never UTF-8 decoded).
  runtime.processTextWithMedia(
    handle,
    "A receipt is attached.",
    "user/profile",
    {
      data: new Uint8Array([0, 255, 1]),
      mimetype: "application/octet-stream",
    },
    { includeEmbedding: false, retention: "durable" }
  );

  const ctx = runtime.processText(
    handle,
    "What should I remember about the garage?",
    "chat/assistant",
    {
      includeEmbedding: false,
      retention: "ephemeral",
      // Optional: fit the packet in ~8,000 tokens (4.35 chars/token).
      evidenceBudgetBytes: 34_800,
    }
  );

  // Standing directives ("Always ...") come back outside the ranked list.
  for (const item of [...(ctx.standing_memory ?? []), ...(ctx.retrieved_memory ?? [])]) {
    // Every signal payload of the memory, each with its own MIME type and
    // timestamp (ms; 0 = unknown); modality is the one its signals share, or
    // "mixed".
    const payloads = (item.content ?? []).map((c) => [c.mimetype, c.timestamp]);
    console.log(item.modality, payloads, item.relevance, item.composite_score);
  }

  // Ask as of a past time: memories nearest it join the candidates, and
  // asOf hides anything stored after it.
  runtime.processText(handle, "What was the garage code then?", "chat/assistant", {
    includeEmbedding: false,
    retention: "ephemeral",
    referenceMs: new Date("2026-01-01T00:00:00Z"),
    asOf: true,
  });

  if (ctx.consolidation_state !== "none") {
    runtime.consolidate(handle);
  }
} finally {
  runtime.flush(handle);
  runtime.freeContext(handle);
}
```

Retention values: `"natural" | "durable" | "boundary" | "ephemeral"` (or `0..3`).

Decoded process maps always include `consolidation_state`
(`none` \| `recommended` \| `required`), including when older engine JSON only
returns boolean flags.

`ProcessOptions` (shared by `processText` and `processTextWithMedia`):

| Option | Notes |
| --- | --- |
| `includeEmbedding` | Return the processed signal's embedding (default `true`) |
| `retention` | `natural` (default), `durable`, `boundary`, `ephemeral` |
| `evidenceBudgetBytes` | Per-call evidence budget in bytes; omitted or `0` returns whole memories. Text counts its UTF-8 bytes, other payloads 480 bytes each; `standing_memory` counts too |
| `referenceMs` | Query reference time (`Date` or ms since the epoch); read by `ephemeral` calls only |
| `asOf` | With `referenceMs`: hide memories stored after it |

Image embedding rejects non-positive dimensions and buffers smaller than
`width * height * channels` before copying into WASM memory.

`processTextWithMedia` accepts `{ data: Uint8Array | ArrayBuffer, mimetype }`.
The text is still used for canonical text processing; media bytes are copied
unchanged and stored with the supplied MIME type in place of the text. `null`
or empty `data` stores the canonical text. A `text/*` MIME type counts as text
(for example toward an evidence budget). It takes the same options as
`processText`.

## Obtaining `cortext.js` + `cortext.wasm`

The TypeScript wrapper is pure JS; the live engine is the Emscripten pair:

| File | Role |
| --- | --- |
| `assets/cortext.js` | ES module factory (`export default createCortextModule`) |
| `assets/cortext.wasm` | Compiled engine + C ABI |

These binaries are **not** committed to git (size / cleanliness). Obtain them:

### A) Vendor from a monorepo engine build

```bash
# In augmem/cortext (requires Emscripten / emcc)
./build-wasm.sh

# In this repo (sibling checkout layout)
npm run vendor:wasm
# or
node scripts/vendor-wasm.mjs --from /path/to/cortext/build-wasm/dist/wasm
```

Search order for `vendor:wasm`:

1. `--from <dir>`
2. `CORTEXT_WASM_DIST`
3. `../cortext/build-wasm/dist/wasm`
4. `../../cortext/build-wasm/dist/wasm`

Or build with CMake from a cortext.cpp checkout:

```bash
cmake --preset wasm && cmake --build build-wasm --target cortext_wasm
node scripts/vendor-wasm.mjs --from /path/to/cortext.cpp/build-wasm/dist/wasm
```

### B) Build-time model preload (engine monorepo)

```bash
cmake --preset wasm -DCORTEXT_WASM_PRELOAD_MODEL_ASSETS_DIR="$PWD/models"
```

Preloading packs the model directory into `cortext.data`, mounted at
`/models` in the virtual FS, so the `write*File` model helpers are optional
for demos. The directory must hold the assembled tree the engine resolves:

```text
models/
  AIST-87M-GGUF/AIST-87M_q8_0.gguf
  AIST-87M-GGUF/AIST-87M-LI.gguf      # late-interaction reranker (required)
  mdbr-leaf-ir/vocab.txt
```

Reassemble the GGUF files from cortext.cpp's `models/AIST-87M-GGUF/chunks/`
(a checkout, or `models/` in the release's `cortext-assets-2.0.0.tar.gz`)
and check them against its `manifest.json` (do not re-shard):

```bash
node scripts/assemble-models.mjs /path/to/cortext.cpp/models ./models
``` Serve
`cortext.data` beside `cortext.js`, or hand it over with Emscripten's
`getPreloadedPackage` option. `vendor:wasm` copies `cortext.data` for local
use; `check:wasm` rejects preload builds before publish, since model files
never ship on npm.

### C) Publish path

`prepublishOnly` runs `npm run test:unit` (build + unit/package tests) then
`scripts/check-wasm.mjs`, which
requires vendored assets. CI unit tests do **not** require the binaries.

## API

| Export | Notes |
| --- | --- |
| `CortextWasm` | Wrapper (`create`, `processText`, `embed*`, `createContext`, FS helpers, `consolidate`, `flush`, `reset`) |
| `normalizeContext` | Pure helper: ensure `consolidation_state` on process JSON |
| `retentionValue` | Pure helper: map retention name/int → C ABI 0–3 |
| `validateImageBuffer` | Pure helper: dimension / buffer checks |
| `evidenceBudgetValue` / `referenceTimeValue` | Pure helpers: validate the budget and reference time for the C ABI |
| `AIST_MODEL_PATH` / `LI_MODEL_PATH` / `VOCAB_PATH` | Virtual-FS paths the engine reads its model files from |
| `PACKAGE_VERSION` | Binding version string (`2.0.0`) |
| Types | `CortextContext`, `Retention`, `ProcessOptions`, `Media`, `CortextEmscriptenModule`, … |
| `@augmem/cortext-wasm/module` | Emscripten factory (when assets are vendored) |

### `CortextWasm` methods

| Method | Notes |
| --- | --- |
| `static create(factory, options?)` | Await Emscripten init |
| `mkdirp` / `writeFile` | Virtual FS helpers |
| `writeModelFile` / `writeLateInteractionModelFile` / `writeTokenizerVocabFile` | Load AIST, the LI reranker and the tokenizer vocab into `/models` |
| `createContext` / `freeContext` | Engine handle lifecycle |
| `processText(handle, text, sourceId?, options?)` | Memory pipeline (default retention `natural`) |
| `processTextWithMedia(handle, text, sourceId?, media, options?)` | Text pipeline storing caller media bytes + MIME type |
| `embedText` / `embedAudio` / `embedImage` | Embed-only |
| `consolidate` / `flush` / `reset` | Engine control |
| `version` / `lastError` | Diagnostics |

Audio input is **16 kHz mono float32 PCM**. Image input is row-major RGB/RGBA
with explicit dimensions.

## Environment / model notes

| Concern | Notes |
| --- | --- |
| AIST GGUF model | Required; load via `writeModelFile` or build-time preload |
| LI reranker (`AIST-87M-LI.gguf`) | Required beside AIST; `writeLateInteractionModelFile` or preload |
| Tokenizer vocab | `/models/mdbr-leaf-ir/vocab.txt`; `writeTokenizerVocabFile` or preload |
| `locateFile` | Pass through Emscripten options when `.wasm` is not co-located |
| OPFS | Engine glue may mount OPFS when available (engine build dependent) |
| Node | Unit tests run without WASM; live engine needs Node WebAssembly + assets |

## Repository layout

```text
cortext.wasm/
  src/                 TypeScript sources (wrapper + pure helpers)
  dist/                build output (CJS + ESM + .d.ts) — not committed
  assets/              vendored cortext.js + cortext.wasm (gitignored binaries)
  scripts/             vendor-wasm, check-wasm, dual-package helpers
  tests/               node:test unit + optional smoke
  .github/workflows/   CI
```

## Develop

```bash
git clone https://github.com/augmem/cortext.wasm.git
cd cortext.wasm
npm install

# Optional: copy WASM from sibling monorepo engine build
npm run vendor:wasm

npm run build
npm test          # build + all tests (smoke skips if no assets)
npm run test:unit # wrapper-only tests (no WASM required)

# Live engine tests (skip unless the vendored assets and models are present)
CORTEXT_AIST_MODEL_PATH=/path/to/models/AIST-87M-GGUF/AIST-87M_q8_0.gguf \
CORTEXT_LI_MODEL_PATH=/path/to/models/AIST-87M-GGUF/AIST-87M-LI.gguf \
node --test tests/engine.test.mjs
# CORTEXT_VOCAB_PATH overrides <models>/mdbr-leaf-ir/vocab.txt;
# CORTEXT_WASM_PRELOAD_DIST=<preload build dist/wasm> adds the preload test.
```

### Build scripts

| Script | Purpose |
| --- | --- |
| `npm run build` | Clean + types + ESM + CJS |
| `npm run typecheck` | `tsc --noEmit` |
| `npm test` | Build + `node --test tests/*.test.mjs` |
| `npm run test:unit` | Unit + package tests only |
| `npm run vendor:wasm` | Copy Emscripten pair into `assets/` |
| `npm run check:wasm` | Fail if assets missing (publish gate) |
| `npm run pack:check` | `npm pack --dry-run` |

## Maintainer release flow

```bash
# 1) Build engine WASM in monorepo and vendor
cd ../cortext && ./build-wasm.sh
cd ../cortext.wasm
npm run vendor:wasm -- --force

# 2) Verify
npm test
node scripts/check-wasm.mjs

# 3) Bump version in package.json + src/index.ts PACKAGE_VERSION + CHANGELOG.md
git tag -a v2.0.0 -m "v2.0.0"
git push origin v2.0.0

# 4) Publish (assets must be present)
npm publish --access public
```

## Why a separate repo?

| Repo | Role |
| --- | --- |
| [`augmem/cortext`](https://github.com/augmem/cortext) | Engine (C++/Zig), in-tree binding prototypes |
| [`augmem/cortext.py`](https://github.com/augmem/cortext.py) | Python |
| [`augmem/cortext.go`](https://github.com/augmem/cortext.go) | Go |
| [`augmem/cortext.ts`](https://github.com/augmem/cortext.ts) | TypeScript / Node N-API (`@augmem/cortext`) |
| [`augmem/cortext.dart`](https://github.com/augmem/cortext.dart) | Dart / Flutter-friendly FFI |
| **`augmem/cortext.wasm`** | Browser WASM (`@augmem/cortext-wasm`) |

Language bindings follow their ecosystem’s packaging norms. Browser WASM
belongs on npm as an ES-module package with typed glue — not only under the
engine monorepo’s `bindings/wasm`.

## License

Apache-2.0. See [LICENSE](./LICENSE) and [NOTICE](./NOTICE).
