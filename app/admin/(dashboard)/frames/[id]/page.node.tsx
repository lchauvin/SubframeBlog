import { notFound } from "next/navigation";

import { editorGearRows } from "@/lib/defaults";
import { getFrameById, getFrameImageRows, getGearItems, pickImage } from "@/server/db/queries";

import { FrameDraftImporter } from "../FrameDraftImporter";
import type { FrameFormValues } from "../FrameForm";
import styles from "../../../admin.module.css";

export const dynamic = "force-dynamic";

export default async function EditFramePage({
  params,
  searchParams,
}: {
  params: Promise<{ id: string }>;
  searchParams: Promise<{ created?: string }>;
}) {
  const { id } = await params;
  const frameId = Number(id);
  if (!Number.isFinite(frameId)) notFound();

  const frame = await getFrameById(frameId);
  if (!frame) notFound();

  const { created } = await searchParams;
  const [imageRows, siteGear] = await Promise.all([
    getFrameImageRows(frame.id),
    getGearItems(),
  ]);
  const preview = pickImage(frame.images, "thumb");

  const values: FrameFormValues = {
    id: frame.id,
    slug: frame.slug,
    catalogId: frame.catalogId,
    commonName: frame.commonName,
    frameNumber: frame.frameNumber,
    revision: frame.revision,
    capturedOn: frame.capturedOn,
    palette: frame.palette,
    bandwidth: frame.bandwidth,
    integrationHours: Math.floor(frame.totalIntegrationMinutes / 60),
    integrationMinutes: frame.totalIntegrationMinutes % 60,
    metaLine: frame.metaLine,
    blurb: frame.blurb,
    bodyMarkdown: frame.bodyMarkdown,
    note: frame.note,
    plateCatalog: frame.plateCatalog,
    plateClass: frame.plateClass,
    plateConstellation: frame.plateConstellation,
    plateDistance: frame.plateDistance,
    plateCoordinates: frame.plateCoordinates,
    platePalette: frame.platePalette,
    plateSessions: frame.plateSessions,
    plateSky: frame.plateSky,
    opticsLabel: frame.opticsLabel,
    sensorLabel: frame.sensorLabel,
    arcsecPerPx: frame.arcsecPerPx === null ? "" : String(frame.arcsecPerPx),
    published: frame.published,
  };

  return (
    <>
      <h1 className={styles.pageTitle}>{frame.catalogId}</h1>
      <p className={styles.pageSub}>
        {frame.published ? "Published" : "Draft"} · /frame/{frame.slug}
      </p>

      <FrameDraftImporter
        defaults={values}
        initialMessage={created ? "Frame created. Upload its master below." : undefined}
        filters={frame.filters.map((f) => ({
          name: f.name,
          subLengthSeconds: f.subLengthSeconds,
          keptFrames: f.keptFrames,
          totalFrames: f.totalFrames,
          hours: f.hours,
        }))}
        nights={frame.nights.map((n) => ({
          nightDate: n.nightDate,
          filterLabel: n.filterLabel,
          subLengthSeconds: n.subLengthSeconds,
          kept: n.kept,
          rejected: n.rejected,
          reason: n.reason,
        }))}
        annotations={frame.annotations.map((a) => ({
          label: a.label,
          xPct: a.xPct,
          yPct: a.yPct,
          radiusPx: a.radiusPx,
        }))}
        gear={editorGearRows(frame.gear, siteGear)}
        imageVariants={imageRows.map((r) => ({
          variant: r.variant,
          format: r.format,
          width: r.width,
          height: r.height,
          bytes: r.bytes,
        }))}
        previewSrc={preview.jpeg?.src ?? preview.webp?.src ?? null}
      />
    </>
  );
}
