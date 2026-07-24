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
  CortextModuleFactory,
  CreateContextOptions,
  ProcessOptions,
  Retention,
  WriteModelFileOptions,
} from "./types.js";

/** Binding package version (tracks engine line). */
export const PACKAGE_VERSION = "1.2.4";
