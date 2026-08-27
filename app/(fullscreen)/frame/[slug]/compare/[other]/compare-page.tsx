import type { Metadata } from "next";
import { notFound } from "next/navigation";

import { CompareViewer } from "@/components/CompareViewer";
import { formatMinutes, formatMonthYear } from "@/lib/format";
import { alignWcs } from "@/server/astrometry/align";
import type { Wcs } from "@/server/astrometry/wcs";
import { getCurrentAdmin } from "@/server/auth/session";
import {
  getFrameBySlug,
  getRevisionChain,
  getSolvedWcs,
  pickImage,
} from "@/server/db/queries";
import { KIND_LABEL } from "@/server/revisions";

const IS_EXPORT = process.env.ASTROBLOG_EXPORT === "1";

type Params = { slug: string; other: string };

/**
 * Emitted when no target has more than one processing.
 *
 * Next refuses a dynamic route under `output: export` whose
 * `generateStaticParams` returns nothing — it reports it as the function being
 * missing entirely — so a site where nothing has been reprocessed could not
 * build a static export at all once this route existed. That is most sites, and
 * it is a build failure rather than a missing page, so it cannot be left to
 * chance. One sentinel pair keeps the route non-empty; it renders as a 404 and
 * `export-site.ts` deletes the directory afterwards.
 */
const EXPORT_SENTINEL: Params = { slug: "__no-revisions__", other: "__no-revisions__" };
export const EXPORT_SENTINEL_SLUG = EXPORT_SENTINEL.slug;

/**
 * Every ordered pair of frames that share a target, for the export.
 *
 * Pairs rather than frames, because the page is about the relationship: a
 * static build has no server to render an unknown combination on demand.
 */
export async function publishedComparePairs(): Promise<Params[]> {
  const { listPublishedFrames } = await import("@/server/db/queries");
  const frames = await listPublishedFrames();
  const pairs: Params[] = [];
  const seen = new Set<string>();

  for (const frame of frames) {
    const chain = await getRevisionChain(frame.id);
    if (!chain) continue;
    for (const member of chain.members) {
      if (member.id === frame.id || !member.published) continue;
      const key = `${frame.slug}|${member.slug}`;
      if (seen.has(key)) continue;
      seen.add(key);
      pairs.push({ slug: frame.slug, other: member.slug });
    }
  }
  return pairs.length > 0 ? pairs : [EXPORT_SENTINEL];
}

export async function compareMetadata({
  params,
}: {
  params: Promise<Params>;
}): Promise<Metadata> {
  const { slug, other } = await params;
  const frame = await getFrameBySlug(slug);
  return {
    title: frame ? `${frame.catalogId} — comparing revisions` : "Not found",
    // A comparison of two of someone's own frames is not a page search engines
    // should be ranking against the frames themselves.
    robots: { index: false, follow: true },
    alternates: { canonical: `/frame/${slug}` },
    description: frame ? `${frame.catalogId}: ${slug} against ${other}.` : undefined,
  };
}

async function renderComparePage({ params }: { params: Promise<Params> }) {
  const { slug, other } = await params;

  const [reference, comparison] = await Promise.all([
    getFrameBySlug(slug),
    getFrameBySlug(other),
  ]);
  if (!reference || !comparison || reference.id === comparison.id) notFound();

  for (const frame of [reference, comparison]) {
    if (!frame.published) {
      if (IS_EXPORT) notFound();
      if (!(await getCurrentAdmin())) notFound();
    }
  }

  // Only frames the site already considers the same target may be compared.
  // Without this the route would happily overlay any two images on the site.
  const chain = await getRevisionChain(reference.id);
  if (!chain || !chain.members.some((m) => m.id === comparison.id)) notFound();

  const index = chain.members.findIndex((m) => m.id === comparison.id);
  const verdict = index > 0 ? chain.verdicts[index] : null;

  const [refWcs, otherWcs] = await Promise.all([
    getSolvedWcs(reference.id),
    getSolvedWcs(comparison.id),
  ]);

  const alignment = refWcs && otherWcs ? alignWcs(refWcs as Wcs, otherWcs as Wcs) : null;

  const side = (frame: typeof reference, label: string) => {
    const image = pickImage(frame.images, "viewer");
    const ref = image.jpeg ?? image.webp;
    return {
      slug: frame.slug,
      label,
      src: ref?.src ?? "",
      width: ref?.width ?? 0,
      height: ref?.height ?? 0,
      capturedLabel: formatMonthYear(frame.capturedOn),
      integrationLabel: formatMinutes(frame.totalIntegrationMinutes),
      paletteLabel: [frame.palette, frame.bandwidth].filter(Boolean).join(" "),
    };
  };

  return (
    <CompareViewer
      title={reference.catalogId}
      reference={side(reference, reference.revision ? `Rev ${reference.revision}` : "This one")}
      other={side(comparison, comparison.revision ? `Rev ${comparison.revision}` : "The other")}
      alignment={alignment}
      changes={verdict?.changes ?? []}
      kindLabel={verdict ? KIND_LABEL[verdict.kind] : "Same target"}
      backHref={`/frame/${reference.slug}`}
    />
  );
}

/**
 * `notFound()` and `redirect()` raise to unwind, so they arrive here looking
 * like crashes. Logging them turns an ordinary 404 into a scary build error —
 * and the export sentinel above deliberately 404s on every build.
 */
function isControlFlow(error: unknown): boolean {
  const digest = (error as { digest?: unknown } | null)?.digest;
  const marker =
    typeof digest === "string" ? digest : error instanceof Error ? error.message : "";
  return (
    marker.startsWith("NEXT_HTTP_ERROR_FALLBACK") ||
    marker.startsWith("NEXT_NOT_FOUND") ||
    marker.startsWith("NEXT_REDIRECT")
  );
}

export async function ComparePage(props: { params: Promise<Params> }) {
  try {
    return await renderComparePage(props);
  } catch (error) {
    if (isControlFlow(error)) throw error;
    let where = "<unresolved>";
    try {
      const { slug, other } = await props.params;
      where = `${slug} vs ${other}`;
    } catch {}
    console.error(`[astroblog] Compare render failed for ${where}.`, error);
    throw error;
  }
}
