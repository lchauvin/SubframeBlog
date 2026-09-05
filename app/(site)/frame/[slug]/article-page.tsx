import type { CSSProperties } from "react";
import type { Metadata } from "next";
import Link from "next/link";
import { notFound } from "next/navigation";
import { ChevronLeft } from "lucide-react";

import { AcquisitionPanel, type NightRow } from "@/components/AcquisitionPanel";
import { FrameImage } from "@/components/FrameImage";
import { PLATE_FIELDS, publicGearRows, DEFAULT_SITE_SETTINGS } from "@/lib/defaults";
import {
  buildChannelMix,
  buildFilterBars,
  formatDayMonth,
  formatMinutes,
  formatMonthYear,
  toParagraphs,
} from "@/lib/format";
import { shareMetadata, siteOrigin } from "@/lib/share-meta";
import { getCurrentAdmin } from "@/server/auth/session";
import { drawnConstellationName, findConstellationCard } from "@/server/cards/constellation";
import { KIND_LABEL } from "@/server/revisions";
import {
  getAdjacentFrames,
  getFrameBySlug,
  getRevisionChain,
  getGearItems,
  getSiteSettings,
  listPublishedSlugs,
  pickImage,
} from "@/server/db/queries";

import styles from "./article.module.css";

/**
 * A static export has no request context, so drafts cannot be previewed there —
 * only published frames are emitted at all.
 */
const IS_EXPORT = process.env.ASTROBLOG_EXPORT === "1";

/**
 * Every published slug, for the export's `generateStaticParams`. A static build
 * has no server to render an unknown slug on demand, so the list has to be
 * known up front.
 */
export async function publishedFrameParams(): Promise<{ slug: string }[]> {
  return (await listPublishedSlugs()).map((slug) => ({ slug }));
}

export async function articleMetadata({
  params,
}: {
  params: Promise<{ slug: string }>;
}): Promise<Metadata> {
  const { slug } = await params;
  try {
    const frame = await getFrameBySlug(slug);
    if (!frame) return { title: "Not found" };
    const title = `${frame.catalogId}${frame.commonName ? ` — ${frame.commonName}` : ""}`;
    if (!frame.published) return { title, description: frame.blurb };
    const [origin, settings] = await Promise.all([siteOrigin(), getSiteSettings()]);
    return shareMetadata({
      title,
      description: frame.blurb,
      images: frame.images,
      path: `/frame/${frame.slug}`,
      origin,
      siteName: (settings ?? DEFAULT_SITE_SETTINGS).siteName,
      type: "article",
    });
  } catch (error) {
    console.error(`[astroblog] Metadata failed for frame "${slug}".`, error);
    throw error;
  }
}

async function renderArticlePage({
  params,
}: {
  params: Promise<{ slug: string }>;
}) {
  const { slug } = await params;
  const frame = await getFrameBySlug(slug);
  if (!frame) notFound();

  // Drafts stay invisible to the public but remain previewable while logged in.
  // The getCurrentAdmin() call reads cookies, which is why it must be skipped
  // when exporting — a static page has no request to read them from.
  if (!frame.published) {
    if (IS_EXPORT) notFound();
    if (!(await getCurrentAdmin())) notFound();
  }

  const [adjacent, siteGear, chain, skyCard] = await Promise.all([
    getAdjacentFrames(frame.id),
    getGearItems(),
    getRevisionChain(frame.id),
    // Null until someone generates the cards from the admin, which is why the
    // panel below is conditional rather than a placeholder.
    findConstellationCard(frame.slug),
  ]);
  const gear = publicGearRows(frame.gear, siteGear);

  const bars = buildFilterBars(frame.filters);
  const mix = buildChannelMix(frame.filters);
  const nightRows: NightRow[] = frame.nights.map((n) => ({
    id: n.id,
    date: formatDayMonth(n.nightDate),
    filterLabel: n.filterLabel,
    sub: n.subLengthSeconds ? `${n.subLengthSeconds}s` : "—",
    kept: n.kept,
    rejected: n.rejected,
    reason: n.reason || "—",
  }));

  const chips = [
    [frame.palette, frame.bandwidth].filter(Boolean).join(" · "),
    frame.opticsLabel,
    [frame.sensorLabel, frame.arcsecPerPx ? `${frame.arcsecPerPx.toFixed(2)}″/px` : null]
      .filter(Boolean)
      .join(" · "),
  ].filter(Boolean);

  const plateValues = PLATE_FIELDS.map((f) => ({
    label: f.label,
    value: frame[f.key] || "—",
  }));

  const viewerImages = pickImage(frame.images, "article");

  // The frosted ground behind the constellation card. The article variant
  // rather than the thumbnail: the wash is only lightly blurred now, so its
  // resolution shows, and this is the same file the page has already loaded
  // for the photograph above.
  const skyBackdrop = viewerImages.jpeg?.src ?? viewerImages.webp?.src ?? null;

  // The caption names the figure that was drawn, which is not always what the
  // plate says: a plate reading "Cygnus / Lacerta border" gets a Cygnus card.
  const skyCardConstellation = drawnConstellationName(frame.plateConstellation);

  return (
    <main className={styles.page}>
      <Link href="/" className={styles.back}>
        <ChevronLeft size={13} strokeWidth={1.5} />
        Back to the log
      </Link>

      <div className={styles.plate}>
        <div className={`${styles.cell} ${styles.cellTarget}`}>
          <div className={styles.cellLabel}>Target</div>
          <h1 className={styles.targetName}>
            {frame.catalogId}
            {frame.commonName ? ` — ${frame.commonName}` : ""}
          </h1>
        </div>

        <div className={styles.cell}>
          <div className={styles.cellLabel}>Frame / Rev</div>
          <div className={styles.cellMono}>
            {frame.frameNumber}
            {frame.revision ? ` / ${frame.revision}` : ""}
          </div>
        </div>

        <div className={`${styles.cell} ${styles.cellLast}`}>
          <div className={styles.cellLabel}>Integration</div>
          <div className={styles.cellMonoAccent}>
            {formatMinutes(frame.totalIntegrationMinutes)}
          </div>
        </div>

        <div className={styles.imageBand}>
          <FrameImage
            images={viewerImages}
            alt={`${frame.catalogId}${frame.commonName ? ` — ${frame.commonName}` : ""}`}
            className={styles.image}
            sizes="(max-width: 1040px) 100vw, 1246px"
            priority
          />
          {chips.length > 0 ? (
            <div className={styles.chips}>
              {chips.map((c) => (
                <span className={styles.chip} key={c}>
                  {c}
                </span>
              ))}
            </div>
          ) : null}
          <Link href={`/frame/${frame.slug}/full`} className={styles.zoomButton}>
            Zoom 1:1
          </Link>
        </div>

        {plateValues.map((p, i) => (
          <div
            className={`${styles.specCell} ${i % 4 === 3 ? styles.cellLast : ""}`}
            key={p.label}
          >
            <div className={styles.specLabel}>{p.label}</div>
            <div className={styles.specValue}>{p.value}</div>
          </div>
        ))}
      </div>

      <div className={styles.body}>
        <div className={styles.narrative}>
          <h2 className={styles.h2}>Target &amp; processing</h2>
          {toParagraphs(frame.bodyMarkdown).map((p, i) => (
            <p className={styles.prose} key={i}>
              {p}
            </p>
          ))}
          {frame.note ? (
            <div className={styles.note}>
              <div className={styles.noteLabel}>Note to self</div>
              <p className={styles.noteBody}>{frame.note}</p>
            </div>
          ) : null}
        </div>

        <div className={styles.data}>
          <AcquisitionPanel bars={bars} mix={mix} nights={nightRows} />

          {skyCard ? (
            <>
              <div className={styles.equipmentLabel}>Where in the sky</div>
              <figure
                className={styles.skyCard}
                style={
                  skyBackdrop
                    ? ({ "--sky-backdrop": `url(${skyBackdrop})` } as CSSProperties)
                    : undefined
                }
              >
                {/* Two layers, because the figure is also used away from the
                    site and must stay free of ruling. They are drawn from one
                    projection pass, so stacking them re-registers exactly. */}
                <div className={styles.skyCardStack}>
                  {skyCard.gridSrc ? (
                    // Decorative: the figure below carries the description.
                    /* eslint-disable-next-line @next/next/no-img-element */
                    <img
                      src={skyCard.gridSrc}
                      width={skyCard.width}
                      height={skyCard.height}
                      alt=""
                      aria-hidden
                      className={styles.skyCardGrid}
                      loading="lazy"
                    />
                  ) : null}
                  {/* Plain <img>, as everywhere else on the site: the card is
                      already the size it is drawn at and needs no pyramid. */}
                  {/* eslint-disable-next-line @next/next/no-img-element */}
                  <img
                    src={skyCard.src}
                    width={skyCard.width}
                    height={skyCard.height}
                    alt={
                      skyCardConstellation
                        ? `${frame.catalogId} marked on the ${skyCardConstellation} figure`
                        : `${frame.catalogId} marked on its constellation figure`
                    }
                    className={styles.skyCardImage}
                    loading="lazy"
                  />
                </div>
                {skyCardConstellation ? (
                  <figcaption className={styles.skyCardCaption}>
                    {skyCardConstellation}
                  </figcaption>
                ) : null}
              </figure>
            </>
          ) : null}

          {gear.length > 0 ? (
            <>
              <div className={styles.equipmentLabel}>Equipment</div>
              {gear.map((g, i) => (
                <div className={styles.equipmentRow} key={`${g.keyLabel}-${i}`}>
                  <div className={styles.equipmentKey}>{g.keyLabel}</div>
                  <div className={styles.equipmentValue}>{g.value}</div>
                </div>
              ))}
            </>
          ) : null}
        </div>
      </div>

      {chain ? (
        <section className={styles.revisions}>
          <div className={styles.adjacentLabel}>
            {chain.members.length} processings of {frame.catalogId}
          </div>
          {/* Oldest first, each hop labelled against the frame directly before
              it. Nothing transitive is claimed: in an A → B → C chain, B → C
              says nothing about what C is to A. */}
          <ol className={styles.revisionList}>
            {chain.members.map((member, i) => {
              const verdict = chain.verdicts[i];
              const current = member.id === frame.id;
              return (
                <li
                  key={member.id}
                  className={`${styles.revisionItem} ${current ? styles.revisionCurrent : ""}`}
                >
                  {verdict ? (
                    <span className={styles.revisionKind}>
                      {KIND_LABEL[verdict.kind]}
                      {verdict.overridden ? "*" : ""}
                    </span>
                  ) : (
                    <span className={styles.revisionKind}>First</span>
                  )}
                  {current ? (
                    <span className={styles.revisionSlug}>
                      {formatMonthYear(member.capturedOn)} · {formatMinutes(member.totalIntegrationMinutes)}
                      <span className={styles.revisionHere}> — you are here</span>
                    </span>
                  ) : (
                    <Link href={`/frame/${member.slug}`} className={styles.revisionSlug}>
                      {formatMonthYear(member.capturedOn)} · {formatMinutes(member.totalIntegrationMinutes)}
                    </Link>
                  )}
                  {verdict && verdict.changes.length > 0 ? (
                    <span className={styles.revisionChanges}>{verdict.changes.join(" · ")}</span>
                  ) : null}
                </li>
              );
            })}
          </ol>
        </section>
      ) : null}

      {adjacent.length > 0 ? (
        <section className={styles.adjacent}>
          <div className={styles.adjacentLabel}>Adjacent frames</div>
          <div className={styles.thumbGrid}>
            {adjacent.map((a) => (
              <Link href={`/frame/${a.slug}`} className={styles.thumb} key={a.id}>
                <div className={styles.thumbFrame}>
                  <FrameImage
                    images={pickImage(a.images, "thumb")}
                    alt={a.catalogId}
                    className={styles.thumbImage}
                    sizes="(max-width: 1040px) 50vw, 300px"
                  />
                </div>
                <div className={styles.thumbId}>{a.catalogId}</div>
                <div className={styles.thumbMeta}>
                  {formatMonthYear(a.capturedOn)} · {formatMinutes(a.totalIntegrationMinutes)}
                </div>
              </Link>
            ))}
          </div>
        </section>
      ) : null}
    </main>
  );
}

export async function ArticlePage(props: {
  params: Promise<{ slug: string }>;
}) {
  try {
    return await renderArticlePage(props);
  } catch (error) {
    let slug = "<unresolved>";
    try {
      slug = (await props.params).slug;
    } catch {}
    console.error(`[astroblog] Article render failed for frame "${slug}".`, error);
    throw error;
  }
}
