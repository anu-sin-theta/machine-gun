import { networkInterfaces } from "node:os";
import type { NextConfig } from "next";

/**
 * The dev server only serves its scripts to localhost by default, so opening
 * the app from another device (http://<this machine's LAN IP>:3000) loads the
 * HTML but never hydrates. Allow this machine's own IPv4 addresses, plus any
 * extra hostnames in DEV_ORIGINS (comma separated). Development only.
 */
const lanAddresses = Object.values(networkInterfaces())
  .flat()
  .filter((i) => i && i.family === "IPv4" && !i.internal)
  .map((i) => i?.address as string);
const extraOrigins = (process.env.DEV_ORIGINS ?? "")
  .split(",")
  .map((s) => s.trim())
  .filter(Boolean);

const nextConfig: NextConfig = {
  allowedDevOrigins: [...lanAddresses, ...extraOrigins],
  cacheComponents: true,
  serverExternalPackages: ["@hiero-ledger/sdk"],
  partialPrefetching: true,
  turbopack: {
    rules: {
      "*.css": {
        loaders: ["@tailwindcss/turbopack"],
        as: "*.css",
      },
    },
  },
};

export default nextConfig;
