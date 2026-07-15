import { fileURLToPath } from "node:url";
import { defineConfig } from "vitest/config";

export default defineConfig({
  resolve: {
    alias: { obsidian: fileURLToPath(new URL("./test/mocks/obsidian.ts", import.meta.url)) }
  },
  test: {
    environment: "node",
    coverage: {
      provider: "v8",
      reporter: ["text", "json-summary"],
      thresholds: { branches: 80, functions: 80, lines: 80, statements: 80 },
      include: ["src/core/**/*.ts", "src/providers/**/*.ts", "src/bridge/**/*.ts"]
    }
  }
});
