import { defineConfig } from "vitest/config";

export default defineConfig({
  test: {
    include: ["src/**/__tests__/**/*.test.ts"],
    fileParallelism: false,
    testTimeout: 60000,
    hookTimeout: 300000,
  },
});
