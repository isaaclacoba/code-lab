import { defineConfig } from "tsup";
import { copyFileSync } from "node:fs";

export default defineConfig({
  entry: { "code-lab": "src/index.ts" },
  format: ["esm", "cjs", "iife"],
  globalName: "CodeLab",
  dts: { entry: "src/index.ts" },
  sourcemap: true,
  clean: true,
  minify: false,
  // Keep optional heavy deps external so a read-only embed pulls in nothing.
  external: ["monaco-editor", "prismjs"],
  onSuccess: async () => {
    copyFileSync("src/code-lab.css", "dist/code-lab.css");
  },
});
