import type { Metadata } from "next";

import { ViewerPage, viewerMetadata, publishedViewerParams } from "./viewer-page";

/** The viewer in the static export — see the article route for why this is split. */
export function generateStaticParams(): Promise<{ slug: string }[]> {
  return publishedViewerParams();
}

export function generateMetadata(props: {
  params: Promise<{ slug: string }>;
}): Promise<Metadata> {
  return viewerMetadata(props);
}

export default ViewerPage;
