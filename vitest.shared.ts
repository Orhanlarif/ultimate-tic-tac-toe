import { defineConfig } from "vitest/config";

/**
 * Workspace packages resolve to their compiled output by default so that plain
 * `node` can run the realtime server in production. Vitest opts back into the
 * TypeScript sources, so tests run against the working tree without a build.
 *
 * Vitest resolves through Vite's SSR pipeline, which keeps its own condition
 * list, so both have to be set. The trailing entries are Vite's own defaults,
 * which are replaced rather than merged once `conditions` is specified.
 */
const conditions = ["@uttt/source", "module", "node", "development|production"];

export const sharedTestConfig = defineConfig({
  resolve: { conditions },
  ssr: { resolve: { conditions } },
  test: {
    environment: "node",
    server: { deps: { inline: [/@uttt\//] } },
  },
});

export default sharedTestConfig;
