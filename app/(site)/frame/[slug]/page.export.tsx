import type { Metadata } from "next";

import { ArticlePage, articleMetadata, publishedFrameParams } from "./article-page";

/**
 * The article route in the static export, where `force-dynamic` is not merely
 * unnecessary but rejected outright — `output: "export"` cannot emit a page it
 * is told never to prerender. Every published slug is enumerated instead.
 *
 * Only the export build sees this file; see `page.node.tsx` for the server one.
 */
export function generateStaticParams(): Promise<{ slug: string }[]> {
  return publishedFrameParams();
}

export function generateMetadata(props: {
  params: Promise<{ slug: string }>;
}): Promise<Metadata> {
  return articleMetadata(props);
}

export default ArticlePage;
