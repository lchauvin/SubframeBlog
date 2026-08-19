import type { NextConfig } from "next";

/**
 * Two build modes.
 *
 * Default — a Node server: the admin, the media route handler and server
 * actions all exist. This is what `npm run dev` uses locally.
 *
 * ASTROBLOG_EXPORT=1 — a static export for shared hosting (Hostinger has no
 * Node on the entry plans). A static export cannot contain route handlers,
 * middleware or server actions, so every route file that needs a server is
 * named `*.node.tsx` / `*.node.ts` and dropped from `pageExtensions` here.
 * That is Next's own mechanism for excluding routes from a build, and it beats
 * shuffling files around at build time.
 */
const isExport = process.env.ASTROBLOG_EXPORT === "1";

const nextConfig: NextConfig = {
  output: isExport ? "export" : undefined,

  pageExtensions: isExport
    ? ["tsx", "ts"]
    : ["node.tsx", "node.ts", "tsx", "ts"],

  // Emits out/frame/ic-1848/index.html rather than out/frame/ic-1848.html, so
  // plain Apache/LiteSpeed serves the URLs without rewrite rules.
  trailingSlash: isExport,

  // better-sqlite3 and sharp are native modules; keep them external to the
  // server bundle so Next does not try to trace/bundle their .node binaries.
  serverExternalPackages: ["better-sqlite3", "sharp"],
  eslint: { ignoreDuringBuilds: true },
};

export default nextConfig;
