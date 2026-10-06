import { defineConfig } from "vitest/config";

export default defineConfig({
  test: {
    include: ["lib/**/*.test.ts", "eval/**/*.test.ts", "db/**/*.test.ts", "scripts/**/*.test.ts", "app/**/*.test.{ts,tsx}"],
    // Gitignored local state (raw data, the classifier's isolated Claude config) is never tested.
    exclude: ["node_modules/**", ".data/**", ".claude-classifier/**", ".next/**"],
  },
});
