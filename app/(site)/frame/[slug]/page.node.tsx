import type { Metadata } from "next";

import { ArticlePage, articleMetadata } from "./article-page";

/**
 * The article route under the Node server.
 *
 * The two builds need opposite route config here and Next only accepts a
 * literal for it — a ternary on the export flag is rejected by its analyzer —
 * so the modes are split by `pageExtensions` instead, the same mechanism the
 * admin routes already use. This file exists only in the Node build; its
 * `page.export.tsx` sibling exists only in the static export.
 *
 * `force-dynamic` is what makes an admin publish visible immediately: SQLite is
 * re-read per request and nothing is held in the route cache.
 */
export const dynamic = "force-dynamic";

export function generateMetadata(props: {
  params: Promise<{ slug: string }>;
}): Promise<Metadata> {
  return articleMetadata(props);
}

export default ArticlePage;
