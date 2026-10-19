/**
 * @augmem/cortext-wasm — browser WebAssembly bindings for Cortext.
 *
 * Package root: https://github.com/augmem/cortext.wasm
 * Engine: https://github.com/augmem/cortext
 * Node/N-API sibling: https://github.com/augmem/cortext.ts (`@augmem/cortext`)
 */

export { CortextWasm } from "./cortext-wasm.js";
export {
  normalizeContext,
  evidenceBudgetValue,
  retentionValue,
  validateImageBuffer,
} from "./normalize.js";
export type {
  ConsolidationState,
  CortextConfig,
  CortextContext,
  CortextEmbedding,
  CortextEmscriptenModule,
  CortextHandle,
  CortextMemory,
  CortextMemoryContent,
  CortextModuleFactory,
  CreateContextOptions,
  ProcessOptions,
  Retention,
  WriteModelFileOptions,
} from "./types.js";

/**
 * Binding package version (this npm package).
 * Target engine line is documented in `ENGINE_VERSION` (default 1.2.4).
 * A vendored `assets/cortext.wasm` may report an older engine `version()` until
 * rebuilt from the monorepo — always check `runtime.version()` at runtime.
 */
export const PACKAGE_VERSION = "1.2.4";

/** Intended engine assets / C ABI line for this binding release. */
export const ENGINE_VERSION_TARGET = "1.2.4";
