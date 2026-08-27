import type { Metadata } from "next";

import { ComparePage, compareMetadata } from "./compare-page";

/** Comparison under the Node server — see the article route for why this is split. */
export const dynamic = "force-dynamic";

export function generateMetadata(props: {
  params: Promise<{ slug: string; other: string }>;
}): Promise<Metadata> {
  return compareMetadata(props);
}

export default ComparePage;
