import { networkInterfaces } from "node:os";
import type { NextConfig } from "next";

// On a hosting platform the default would silently proxy to nothing: insist on it.
if (process.env.VERCEL && !process.env.BACKEND_URL)
  throw new Error(
    "Set BACKEND_URL to the deployed Kavach402 backend, e.g. https://kavach402.vercel.app",
  );
const BACKEND_URL = (process.env.BACKEND_URL ?? "http://localhost:3000").replace(
  /\/+$/,
  "",
);

/**
 * The dev server only serves its scripts to localhost by default, so opening
 * the app from another device (http://<this machine's LAN IP>:3001) loads the
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
  // The payment check names the merchant by its URL on the backend.
  env: { NEXT_PUBLIC_BACKEND_URL: BACKEND_URL },
  turbopack: {
    rules: {
      "*.css": {
        loaders: ["@tailwindcss/turbopack"],
        as: "*.css",
      },
    },
  },
  async rewrites() {
    return [
      {
        source: "/api/:path*",
        destination: `${BACKEND_URL}/api/:path*`,
      },
      {
        source: "/.well-known/agent-card.json",
        destination: `${BACKEND_URL}/.well-known/agent-card.json`,
      },
    ];
  },
};

export default nextConfig;
