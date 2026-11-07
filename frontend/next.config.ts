import type { NextConfig } from "next";

const BACKEND_URL = process.env.BACKEND_URL ?? "http://localhost:3000";

const nextConfig: NextConfig = {
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
