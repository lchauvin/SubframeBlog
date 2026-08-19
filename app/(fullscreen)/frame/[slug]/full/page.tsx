import type { Metadata } from "next";
import { notFound } from "next/navigation";

import { Viewer } from "@/components/Viewer";
import { formatMinutes } from "@/lib/format";
import { getCurrentAdmin } from "@/server/auth/session";
import { getFrameBySlug, getSiteSettings, pickImage } from "@/server/db/queries";

export const dynamic = "force-dynamic";

export async function generateMetadata({
  params,
}: {
  params: Promise<{ slug: string }>;
}): Promise<Metadata> {
  const { slug } = await params;
  const frame = await getFrameBySlug(slug);
  return { title: frame ? `${frame.catalogId} — full resolution` : "Not found" };
}

export default async function ViewerPage({
  params,
}: {
  params: Promise<{ slug: string }>;
}) {
  const { slug } = await params;
  const frame = await getFrameBySlug(slug);
  if (!frame) notFound();
  if (!frame.published && !(await getCurrentAdmin())) notFound();

  const settings = await getSiteSettings();

  const viewerImages = pickImage(frame.images, "viewer");
  // Pixel dimensions come from the master where one exists, falling back to the
  // largest derivative — never from a hardcoded constant.
  const master = frame.images.master?.jpeg ?? frame.images.master?.webp;
  const largest = viewerImages.jpeg ?? viewerImages.webp;

  return (
    <Viewer
      title={frame.catalogId}
      alt={`${frame.catalogId}${frame.commonName ? ` — ${frame.commonName}` : ""}`}
      image={viewerImages}
      masterWidth={master?.width ?? largest?.width ?? 0}
      masterHeight={master?.height ?? largest?.height ?? 0}
      arcsecPerPx={frame.arcsecPerPx}
      annotations={frame.annotations.map((a) => ({
        id: a.id,
        label: a.label,
        xPct: a.xPct,
        yPct: a.yPct,
        radiusPx: a.radiusPx,
      }))}
      metaLine={frame.metaLine}
      chipLabel={`${formatMinutes(frame.totalIntegrationMinutes)} · ${frame.palette}`}
      articleHref={`/frame/${frame.slug}`}
      downloadHref={frame.images.download?.jpeg?.src ?? null}
      contactHref={settings?.contactHref ?? ""}
    />
  );
}
