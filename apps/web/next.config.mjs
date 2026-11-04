import { fileURLToPath } from "node:url";

/** @type {import('next').NextConfig} */
const nextConfig = {
  // Self-contained server.js + minimal node_modules for the droplet (middleware.ts rules out a static export).
  output: "standalone",
  outputFileTracingRoot: fileURLToPath(new URL("../..", import.meta.url)),
  eslint: {
    ignoreDuringBuilds: true,
  },
  typescript: {
    ignoreBuildErrors: true,
  },
};

export default nextConfig;
