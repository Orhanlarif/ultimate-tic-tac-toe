import { config } from "dotenv";
import type { NextConfig } from "next";
import createNextIntlPlugin from "next-intl/plugin";
import { fileURLToPath } from "node:url";

// Next.js runs from apps/web, while the shared environment lives at the
// monorepo root. Load it explicitly so web-issued realtime tokens use the
// same signing secret as the Socket.IO server.
config({ path: fileURLToPath(new URL("../../.env", import.meta.url)) });

const withNextIntl = createNextIntlPlugin("./src/i18n/request.ts");

const nextConfig: NextConfig = {
  // Local `next build` writes beside `.next` so it does not clobber a running
  // `next dev`. On Vercel the platform owns the output directory, so stay on
  // the default there.
  distDir:
    process.env.NODE_ENV === "production" && !process.env.VERCEL
      ? ".next-build"
      : ".next",
  // The floating Next.js "N" badge sits on top of mobile layouts during local
  // development and looks like a broken avatar; hide it.
  devIndicators: false,
  transpilePackages: [
    "@uttt/contracts",
    "@uttt/game-engine",
    "@uttt/rating",
    "@uttt/db",
    "@uttt/bot",
  ],
  webpack(config) {
    config.resolve.extensionAlias = {
      ...config.resolve.extensionAlias,
      ".js": [".ts", ".tsx", ".js"],
    };
    // Resolve @uttt/* to their TypeScript sources rather than their compiled
    // output, so the workspace does not have to be built before `next dev`.
    config.resolve.conditionNames = [
      "@uttt/source",
      ...(config.resolve.conditionNames ?? ["require", "node"]),
    ];
    return config;
  },
};

export default withNextIntl(nextConfig);
