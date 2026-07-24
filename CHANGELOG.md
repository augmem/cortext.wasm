# Changelog

All notable changes to `@augmem/cortext-wasm` (this repository: **cortext.wasm**)
are documented here.

The format is based on [Keep a Changelog](https://keepachangelog.com/en/1.1.0/),
and this project aims to follow [Semantic Versioning](https://semver.org/).

## [1.2.4] - 2026-07-24

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
