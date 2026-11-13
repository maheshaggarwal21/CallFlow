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
  // pages removed in the Nov 2026 revamp: old bookmarks land on the person's home instead of a 404
  async redirects() {
    return ["overview", "team", "employees", "employees/:id", "misc", "settings"].map((p) => ({
      source: `/dashboard/${p}`, destination: "/dashboard", permanent: false,
    }));
  },
};

export default nextConfig;
