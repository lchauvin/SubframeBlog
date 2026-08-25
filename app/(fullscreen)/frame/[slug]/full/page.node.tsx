import type { Metadata } from "next";

import { ViewerPage, viewerMetadata } from "./viewer-page";

/** The viewer under the Node server — see the article route for why this is split. */
export const dynamic = "force-dynamic";

export function generateMetadata(props: {
  params: Promise<{ slug: string }>;
}): Promise<Metadata> {
  return viewerMetadata(props);
}

export default ViewerPage;
