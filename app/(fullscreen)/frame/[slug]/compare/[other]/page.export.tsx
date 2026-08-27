import type { Metadata } from "next";

import { ComparePage, compareMetadata, publishedComparePairs } from "./compare-page";

/** Comparison in the static export — every ordered pair that shares a target. */
export function generateStaticParams(): Promise<{ slug: string; other: string }[]> {
  return publishedComparePairs();
}

export function generateMetadata(props: {
  params: Promise<{ slug: string; other: string }>;
}): Promise<Metadata> {
  return compareMetadata(props);
}

export default ComparePage;
