import { defineConfig } from "tsup";

export default defineConfig({
  entry: ["src/index.ts"],
  // Dual output so both ESM (`import`) and CommonJS (`require`) consumers work.
  format: ["esm", "cjs"],
  dts: true,
  sourcemap: true,
  clean: true,
  treeshake: true,
  // The SDK targets browsers and Node alike (fetch / crypto.subtle / EventSource,
  // with a Node `crypto` fallback used only when WebCrypto is unavailable), so
  // keep the bundle platform-neutral and leave the builtin `crypto` import
  // external rather than bundling or polyfilling it. Every other global the SDK
  // uses resolves at runtime in either environment.
  platform: "neutral",
  target: "es2022",
  external: ["node:crypto", "crypto"],
  outDir: "dist",
});
