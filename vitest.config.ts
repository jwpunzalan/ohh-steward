import { defineConfig } from "vitest/config";

export default defineConfig({
  test: {
    include: ["tests/rls/**/*.test.ts"],
    testTimeout: 20000,
  },
});
