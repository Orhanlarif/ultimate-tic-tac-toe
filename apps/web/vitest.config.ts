import { mergeConfig } from "vitest/config";
import { sharedTestConfig } from "../../vitest.shared.js";

export default mergeConfig(sharedTestConfig, {
  test: {
    exclude: ["**/node_modules/**", "**/e2e/**"],
  },
});
