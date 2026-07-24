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

Binding package **1.2.4** targets engine line **v1.2.4** (`ENGINE_VERSION`).
The vendored Emscripten binary reports its own identity via
`runtime.version()` — rebuild monorepo WASM after engine bumps before
claiming binary parity.

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

// Load the AIST GGUF embedding model into the Emscripten VFS
const file = document.querySelector<HTMLInputElement>("#model")!.files![0];
await runtime.writeModelFile(file);

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

  const ctx = runtime.processText(
    handle,
    "What should I remember about the garage?",
    "chat/assistant",
    { includeEmbedding: false, retention: "ephemeral" }
  );

  for (const item of ctx.retrieved_memory ?? []) {
    console.log(item.text, item.relevance, item.composite_score);
  }

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

Image embedding rejects non-positive dimensions and buffers smaller than
`width * height * channels` before copying into WASM memory.

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

### B) Build-time model preload (engine monorepo)

```bash
./build-wasm.sh -DCORTEXT_WASM_PRELOAD_MODEL_ASSETS_DIR="$PWD/models"
```

Preloading writes the model directory to `/models` inside the virtual FS so
runtime `writeModelFile` is optional for demos.

### C) Publish path

`prepublishOnly` runs `npm run build` and `scripts/check-wasm.mjs`, which
requires vendored assets. CI unit tests do **not** require the binaries.

## API

| Export | Notes |
| --- | --- |
| `CortextWasm` | Wrapper (`create`, `processText`, `embed*`, `createContext`, FS helpers, `consolidate`, `flush`, `reset`) |
| `normalizeContext` | Pure helper: ensure `consolidation_state` on process JSON |
| `retentionValue` | Pure helper: map retention name/int → C ABI 0–3 |
| `validateImageBuffer` | Pure helper: dimension / buffer checks |
| `PACKAGE_VERSION` | Binding version string (`1.2.4`) |
| Types | `CortextContext`, `Retention`, `ProcessOptions`, `CortextEmscriptenModule`, … |
| `@augmem/cortext-wasm/module` | Emscripten factory (when assets are vendored) |

### `CortextWasm` methods

| Method | Notes |
| --- | --- |
| `static create(factory, options?)` | Await Emscripten init |
| `mkdirp` / `writeFile` / `writeModelFile` | Virtual FS helpers |
| `createContext` / `freeContext` | Engine handle lifecycle |
| `processText(handle, text, sourceId?, options?)` | Memory pipeline (default retention `natural`) |
| `embedText` / `embedAudio` / `embedImage` | Embed-only |
| `consolidate` / `flush` / `reset` | Engine control |
| `version` / `lastError` | Diagnostics |

Audio input is **16 kHz mono float32 PCM**. Image input is row-major RGB/RGBA
with explicit dimensions.

## Environment / model notes

| Concern | Notes |
| --- | --- |
| AIST GGUF model | Still required; load via `writeModelFile` or build-time preload |
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
git tag v1.2.4
git push origin v1.2.4

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
