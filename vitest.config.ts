import { fileURLToPath } from "node:url";
import { defineConfig } from "vitest/config";

export default defineConfig({
  resolve: {
    // Tests run server code directly, as React Server Components do. Next.js resolves
    // "server-only" to this same empty file for server code; client bundles get the throwing one.
    alias: { "server-only": fileURLToPath(new URL("node_modules/server-only/empty.js", import.meta.url)) },
  },
  test: {
    include: ["src/**/*.test.{ts,tsx}"],
    environment: "node",
    setupFiles: ["src/test/no-network.ts"],
    // Unit tests must never reach a real engine API (CS-12): no keys in CI.
    env: {
      OPENAI_API_KEY: "",
      PERPLEXITY_API_KEY: "",
      GEMINI_API_KEY: "",
    },
  },
});
