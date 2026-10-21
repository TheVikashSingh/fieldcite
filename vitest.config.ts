import { defineConfig } from "vitest/config";

export default defineConfig({
  test: {
    include: ["src/**/*.test.ts"],
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
