import { defineConfig } from "vitest/config";

export default defineConfig({
  base: "./",
  test: {
    setupFiles: ["./tests/setup-foundry-sdk.ts"],
  },
  build: {
    outDir: "dist/renderer",
    emptyOutDir: false,
    sourcemap: true,
    target: "chrome142",
  },
});
