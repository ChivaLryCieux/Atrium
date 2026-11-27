import { defineConfig } from "vitest/config";

// Atrium frontend unit tests live next to the modules they cover under src/.
// The vendored kernel checkouts (deepseek-harness/, .kernel-build/) carry
// their own upstream suites and are explicitly out of scope.
export default defineConfig({
  test: {
    include: ["src/**/*.test.{ts,tsx}"],
    environment: "node",
  },
});
