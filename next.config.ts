import type { NextConfig } from "next";

const nextConfig: NextConfig = {
  // better-sqlite3 and sharp are native modules; keep them external to the
  // server bundle so Next does not try to trace/bundle their .node binaries.
  serverExternalPackages: ["better-sqlite3", "sharp"],
  eslint: { ignoreDuringBuilds: true },
};

export default nextConfig;
