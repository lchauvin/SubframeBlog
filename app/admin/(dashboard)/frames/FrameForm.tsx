"use client";

import { useActionState, useState } from "react";
import { useFormStatus } from "react-dom";
import Link from "next/link";

import { RowEditor, type RowValue } from "@/components/admin/RowEditor";
import { ImageUploader, type VariantSummary } from "@/components/admin/ImageUploader";
import { SolveStatus } from "@/components/admin/SolveStatus";
import { AnnotationPreview } from "@/components/admin/AnnotationPreview";
import { slugify } from "@/lib/format";

import { deleteFrame, saveFrame, type FormState } from "../../actions";
import styles from "../../admin.module.css";

export type FrameFormValues = {
  id: number | null;
  slug: string;
  catalogId: string;
  commonName: string;
  frameNumber: string;
  revision: string;
  capturedOn: string;
  palette: string;
  bandwidth: string;
  integrationHours: number;
  integrationMinutes: number;
  metaLine: string;
  blurb: string;
  bodyMarkdown: string;
  note: string;
  plateCatalog: string;
  plateClass: string;
  plateConstellation: string;
  plateDistance: string;
  plateCoordinates: string;
  platePalette: string;
  plateSessions: string;
  plateSky: string;
  opticsLabel: string;
  sensorLabel: string;
  arcsecPerPx: string;
  published: boolean;
};

const PLATE_FIELDS: { key: keyof FrameFormValues; label: string }[] = [
  { key: "plateCatalog", label: "Catalog" },
  { key: "plateClass", label: "Class" },
  { key: "plateConstellation", label: "Constellation" },
  { key: "plateDistance", label: "Distance" },
  { key: "plateCoordinates", label: "Coordinates" },
  { key: "platePalette", label: "Palette" },
  { key: "plateSessions", label: "Sessions" },
  { key: "plateSky", label: "Sky" },
];

function SaveButton() {
  const { pending } = useFormStatus();
  return (
    <button type="submit" className={styles.buttonPrimary} disabled={pending}>
      {pending ? "Saving…" : "Save frame"}
    </button>
  );
}

function DeleteButton() {
  const { pending } = useFormStatus();
  return (
    <button
      type="submit"
      formAction={deleteFrame}
      className={`${styles.button} ${styles.buttonDanger}`}
      disabled={pending}
      onClick={(e) => {
        if (!window.confirm("Delete this frame and all of its images? This cannot be undone.")) {
          e.preventDefault();
        }
      }}
    >
      Delete frame
    </button>
  );
}

export function FrameForm({
  values,
  filters,
  nights,
  annotations,
  imageVariants,
  previewSrc,
  initialMessage,
}: {
  values: FrameFormValues;
  filters: RowValue[];
  nights: RowValue[];
  annotations: RowValue[];
  imageVariants: VariantSummary[];
  previewSrc: string | null;
  initialMessage?: string;
}) {
  const [state, formAction] = useActionState<FormState, FormData>(
    saveFrame,
    initialMessage ? { success: initialMessage } : {},
  );

  const [catalogId, setCatalogId] = useState(values.catalogId);
  const [slug, setSlug] = useState(values.slug);
  const [slugTouched, setSlugTouched] = useState(Boolean(values.slug));
  const [annotationRows, setAnnotationRows] = useState(annotations);

  // Auto-derive the slug until it is edited by hand, then leave it alone.
  const effectiveSlug = slugTouched ? slug : slugify(catalogId);

  const text = (key: keyof FrameFormValues, label: string, wide = false) => (
    <div className={`${styles.field} ${wide ? styles.fieldWide : ""}`}>
      <label className={styles.label} htmlFor={key}>
        {label}
      </label>
      <input
        id={key}
        name={key}
        className={styles.input}
        defaultValue={String(values[key] ?? "")}
      />
    </div>
  );

  return (
    <form action={formAction}>
      {values.id ? <input type="hidden" name="id" value={values.id} /> : null}

      {state.error ? (
        <div className={styles.error} role="alert">
          {state.error}
        </div>
      ) : null}
      {state.success ? (
        <div className={styles.success} role="status">
          {state.success}
        </div>
      ) : null}

      <section className={styles.section}>
        <h2 className={styles.sectionTitle}>Identity</h2>
        <div className={styles.grid4}>
          <div className={`${styles.field} ${styles.fieldWide}`} style={{ gridColumn: "span 2" }}>
            <label className={styles.label} htmlFor="catalogId">
              Catalog ID
            </label>
            <input
              id="catalogId"
              name="catalogId"
              className={styles.input}
              value={catalogId}
              onChange={(e) => setCatalogId(e.target.value)}
              required
            />
          </div>

          <div className={styles.field} style={{ gridColumn: "span 2" }}>
            <label className={styles.label} htmlFor="commonName">
              Common name
            </label>
            <input
              id="commonName"
              name="commonName"
              className={styles.input}
              defaultValue={values.commonName}
            />
          </div>

          <div className={styles.field} style={{ gridColumn: "span 2" }}>
            <label className={styles.label} htmlFor="slug">
              Slug
            </label>
            <input
              id="slug"
              name="slug"
              className={`${styles.input} ${styles.mono}`}
              value={effectiveSlug}
              onChange={(e) => {
                setSlugTouched(true);
                setSlug(e.target.value);
              }}
            />
            <span className={styles.hint}>
              /frame/{effectiveSlug || "…"}
              {values.id ? " — changing this breaks the existing URL" : ""}
            </span>
          </div>

          <div className={styles.field}>
            <label className={styles.label} htmlFor="capturedOn">
              Captured on
            </label>
            <input
              id="capturedOn"
              name="capturedOn"
              type="date"
              className={styles.input}
              defaultValue={values.capturedOn}
              required
            />
            <span className={styles.hint}>Sorts the log, newest first</span>
          </div>

          <div className={styles.field}>
            <label className={styles.label}>Published</label>
            <span className={styles.checkboxRow}>
              <input
                id="published"
                name="published"
                type="checkbox"
                defaultChecked={values.published}
              />
              <label htmlFor="published" className={styles.hint}>
                Visible on the log
              </label>
            </span>
          </div>

          {text("frameNumber", "Frame number")}
          {text("revision", "Revision")}
          {text("palette", "Palette")}
          {text("bandwidth", "Bandwidth")}

          <div className={styles.field}>
            <label className={styles.label} htmlFor="integrationHours">
              Integration — hours
            </label>
            <input
              id="integrationHours"
              name="integrationHours"
              type="number"
              min={0}
              className={styles.input}
              defaultValue={values.integrationHours}
            />
          </div>

          <div className={styles.field}>
            <label className={styles.label} htmlFor="integrationMinutes">
              Integration — minutes
            </label>
            <input
              id="integrationMinutes"
              name="integrationMinutes"
              type="number"
              min={0}
              max={59}
              className={styles.input}
              defaultValue={values.integrationMinutes}
            />
          </div>
        </div>
      </section>

      <section className={styles.section}>
        <h2 className={styles.sectionTitle}>Log entry</h2>
        <div className={styles.grid2}>
          {text("metaLine", "Meta line", true)}
          <div className={`${styles.field} ${styles.fieldWide}`}>
            <label className={styles.label} htmlFor="blurb">
              Blurb
            </label>
            <textarea
              id="blurb"
              name="blurb"
              className={styles.textarea}
              defaultValue={values.blurb}
            />
            <span className={styles.hint}>Shown on the log row, one or two sentences</span>
          </div>
        </div>
      </section>

      <section className={styles.section}>
        <h2 className={styles.sectionTitle}>Spec plate</h2>
        <div className={styles.grid2}>
          {PLATE_FIELDS.map((f) => (
            <div className={styles.field} key={f.key}>
              <label className={styles.label} htmlFor={f.key}>
                {f.label}
              </label>
              <input
                id={f.key}
                name={f.key}
                className={styles.input}
                defaultValue={String(values[f.key] ?? "")}
              />
            </div>
          ))}
        </div>
      </section>

      <section className={styles.section}>
        <h2 className={styles.sectionTitle}>Target &amp; processing</h2>
        <div className={styles.field}>
          <label className={styles.label} htmlFor="bodyMarkdown">
            Body
          </label>
          <textarea
            id="bodyMarkdown"
            name="bodyMarkdown"
            className={`${styles.textarea} ${styles.textareaTall}`}
            defaultValue={values.bodyMarkdown}
          />
          <span className={styles.hint}>Blank line between paragraphs. Prose, not a step list.</span>
        </div>

        <div className={styles.field} style={{ marginTop: 14 }}>
          <label className={styles.label} htmlFor="note">
            Note to self
          </label>
          <textarea id="note" name="note" className={styles.textarea} defaultValue={values.note} />
        </div>
      </section>

      <section className={styles.section}>
        <h2 className={styles.sectionTitle}>Capture chips</h2>
        <div className={styles.grid3}>
          {text("opticsLabel", "Optics label")}
          {text("sensorLabel", "Sensor label")}
          <div className={styles.field}>
            <label className={styles.label} htmlFor="arcsecPerPx">
              Arcsec / px
            </label>
            <input
              id="arcsecPerPx"
              name="arcsecPerPx"
              className={styles.input}
              defaultValue={values.arcsecPerPx}
              inputMode="decimal"
            />
          </div>
        </div>
      </section>

      <section className={styles.section}>
        <h2 className={styles.sectionTitle}>Per-filter integration</h2>
        <RowEditor
          name="filtersJson"
          initialRows={filters}
          addLabel="Add filter"
          emptyLabel="No filters — the bar chart will be empty."
          blankRow={{
            name: "",
            subLengthSeconds: 300,
            keptFrames: 0,
            totalFrames: 0,
            hours: 0,
          }}
          columns={[
            { key: "name", label: "Filter", width: "1.4fr", placeholder: "Hα 3nm" },
            { key: "subLengthSeconds", label: "Sub (s)", type: "number", width: "0.7fr" },
            { key: "keptFrames", label: "Kept", type: "number", width: "0.7fr" },
            { key: "totalFrames", label: "Total", type: "number", width: "0.7fr" },
            { key: "hours", label: "Hours kept", type: "number", step: "0.01", width: "0.9fr" },
          ]}
        />
        <p className={styles.hint} style={{ marginTop: 10 }}>
          These are authoritative — the bars, the legend and the totals all read from here.
          Rejected time is derived as (hours ÷ kept) × (total − kept).
        </p>
      </section>

      <section className={styles.section}>
        <h2 className={styles.sectionTitle}>Night log — optional</h2>
        <RowEditor
          name="nightsJson"
          initialRows={nights}
          addLabel="Add night"
          emptyLabel="No nights recorded — the frame-by-frame toggle stays hidden."
          blankRow={{
            nightDate: "",
            filterLabel: "",
            subLengthSeconds: 300,
            kept: 0,
            rejected: 0,
            reason: "—",
          }}
          columns={[
            { key: "nightDate", label: "Night", type: "date", width: "1.2fr" },
            { key: "filterLabel", label: "Filter", width: "0.8fr", placeholder: "Hα" },
            { key: "subLengthSeconds", label: "Sub (s)", type: "number", width: "0.7fr" },
            { key: "kept", label: "Kept", type: "number", width: "0.6fr" },
            { key: "rejected", label: "Rej.", type: "number", width: "0.6fr" },
            { key: "reason", label: "Reason", width: "1.1fr", placeholder: "Cloud" },
          ]}
        />
        <p className={styles.hint} style={{ marginTop: 10 }}>
          Display only. Nothing is recomputed from these rows, so they can disagree with the
          per-filter numbers above — keep them in step yourself.
        </p>
      </section>

      <section className={styles.section}>
        <h2 className={styles.sectionTitle}>Viewer annotations</h2>
        {values.id ? (
          <SolveStatus frameId={values.id} onAnnotations={setAnnotationRows} />
        ) : null}
        <AnnotationPreview imageSrc={previewSrc} rows={annotationRows} />
        <RowEditor
          name="annotationsJson"
          initialRows={annotations}
          rows={annotationRows}
          onRowsChange={setAnnotationRows}
          addLabel="Add marker"
          emptyLabel="No markers — the Annotations toggle will show nothing."
          blankRow={{ label: "", xPct: 50, yPct: 50, radiusPx: 30 }}
          columns={[
            { key: "label", label: "Label", width: "1.6fr", placeholder: "NGC 6888" },
            { key: "xPct", label: "X %", type: "number", step: "0.1", width: "0.7fr" },
            { key: "yPct", label: "Y %", type: "number", step: "0.1", width: "0.7fr" },
            { key: "radiusPx", label: "Ø px", type: "number", step: "1", width: "0.7fr" },
          ]}
        />
        <p className={styles.hint} style={{ marginTop: 10 }}>
          X and Y are percentages from the top-left of the image. Ø is the circle diameter in
          design pixels — measured against a nominal 1600px-wide image, so a marker covers the
          same patch of sky on any screen. These are filled in automatically by the plate solve
          when you upload a master; edit or delete freely.
        </p>
      </section>

      {values.id ? (
        <section className={styles.section}>
          <h2 className={styles.sectionTitle}>Image</h2>
          <ImageUploader
            frameId={values.id}
            previewSrc={previewSrc}
            variants={imageVariants}
          />
        </section>
      ) : (
        <section className={styles.section}>
          <h2 className={styles.sectionTitle}>Image</h2>
          <p className={styles.hint}>Save the frame first, then upload its master here.</p>
        </section>
      )}

      <div className={styles.actions}>
        <SaveButton />
        {values.id ? (
          <Link
            href={`/frame/${values.slug}`}
            className={styles.button}
            target="_blank"
          >
            View ↗
          </Link>
        ) : null}
        <span className={styles.spacer} />
        {values.id ? <DeleteButton /> : null}
      </div>
    </form>
  );
}
