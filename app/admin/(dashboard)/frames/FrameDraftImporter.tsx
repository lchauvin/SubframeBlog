"use client";

import { useState, type ChangeEvent } from "react";

import type { RowValue } from "@/components/admin/RowEditor";
import type { VariantSummary } from "@/components/admin/ImageUploader";

import { FrameForm, type FrameFormValues } from "./FrameForm";
import styles from "../../admin.module.css";

const STRING_FIELDS: (keyof FrameFormValues)[] = [
  "slug",
  "catalogId",
  "commonName",
  "frameNumber",
  "revision",
  "capturedOn",
  "palette",
  "bandwidth",
  "metaLine",
  "blurb",
  "bodyMarkdown",
  "note",
  "plateCatalog",
  "plateClass",
  "plateConstellation",
  "plateDistance",
  "plateCoordinates",
  "platePalette",
  "plateSessions",
  "plateSky",
  "opticsLabel",
  "sensorLabel",
  "arcsecPerPx",
];

function isRecord(value: unknown): value is Record<string, unknown> {
  return typeof value === "object" && value !== null && !Array.isArray(value);
}

function importValues(
  raw: Record<string, unknown>,
  defaults: FrameFormValues,
): FrameFormValues {
  const next = { ...defaults };

  for (const key of STRING_FIELDS) {
    if (defaults.id !== null && key === "slug") continue;
    const value = raw[key];
    if (typeof value === "string" || typeof value === "number") {
      // arcsecPerPx is emitted as a number by the importer but entered as text.
      (next as Record<string, unknown>)[key] = String(value);
    }
  }

  for (const key of ["integrationHours", "integrationMinutes"] as const) {
    const value = Number(raw[key]);
    if (Number.isFinite(value)) next[key] = Math.max(0, Math.trunc(value));
  }

  if (defaults.id === null && typeof raw.published === "boolean") {
    next.published = raw.published;
  }

  if (!next.catalogId.trim()) throw new Error("frame.catalogId is required.");
  if (!/^\d{4}-\d{2}-\d{2}$/.test(next.capturedOn)) {
    throw new Error("frame.capturedOn must be YYYY-MM-DD.");
  }
  if (next.integrationMinutes > 59) {
    throw new Error("frame.integrationMinutes must be between 0 and 59.");
  }

  return next;
}

function importRows(raw: unknown, label: string): RowValue[] {
  if (!Array.isArray(raw)) throw new Error(`${label} must be an array.`);

  return raw.map((row, index) => {
    if (!isRecord(row)) throw new Error(`${label}[${index}] must be an object.`);
    const result: RowValue = {};
    for (const [key, value] of Object.entries(row)) {
      if (typeof value === "string" || typeof value === "number") result[key] = value;
    }
    return result;
  });
}

function importFilterRows(raw: unknown): RowValue[] {
  return importRows(raw, "filters").map((row, index) => {
    if (!("integrationHours" in row) && !("integrationMinutes" in row)) return row;

    const hours = Number(row.integrationHours ?? 0);
    const minutes = Number(row.integrationMinutes ?? 0);
    if (!Number.isFinite(hours) || !Number.isFinite(minutes) || minutes < 0 || minutes > 59) {
      throw new Error(`filters[${index}] has an invalid integration duration.`);
    }

    const { integrationHours: _hours, integrationMinutes: _minutes, ...rest } = row;
    return {
      ...rest,
      // The existing admin/database field stores decimal hours internally.
      hours: Number((hours + minutes / 60).toFixed(4)),
    };
  });
}

export function FrameDraftImporter({
  defaults,
  filters: initialFilters = [],
  nights: initialNights = [],
  annotations: initialAnnotations = [],
  imageVariants = [],
  previewSrc = null,
  initialMessage,
}: {
  defaults: FrameFormValues;
  filters?: RowValue[];
  nights?: RowValue[];
  annotations?: RowValue[];
  imageVariants?: VariantSummary[];
  previewSrc?: string | null;
  initialMessage?: string;
}) {
  const [values, setValues] = useState(defaults);
  const [filters, setFilters] = useState<RowValue[]>(initialFilters);
  const [nights, setNights] = useState<RowValue[]>(initialNights);
  const [annotations, setAnnotations] = useState<RowValue[]>(initialAnnotations);
  const [formVersion, setFormVersion] = useState(0);
  const [message, setMessage] = useState<{ kind: "error" | "success"; text: string } | null>(
    null,
  );

  const importDraft = async (event: ChangeEvent<HTMLInputElement>) => {
    const file = event.target.files?.[0];
    event.target.value = "";
    if (!file) return;

    try {
      if (file.size > 2 * 1024 * 1024) throw new Error("JSON draft must be smaller than 2 MB.");
      const parsed: unknown = JSON.parse(await file.text());
      if (!isRecord(parsed)) throw new Error("The JSON root must be an object.");
      if (!isRecord(parsed.frame)) throw new Error("The JSON must contain a frame object.");

      const nextValues = importValues(parsed.frame, defaults);
      const nextFilters = importFilterRows(parsed.filters);
      const nextNights = importRows(parsed.nights, "nights");
      const nextAnnotations = importRows(parsed.annotations ?? [], "annotations");

      setValues(nextValues);
      setFilters(nextFilters);
      setNights(nextNights);
      setAnnotations(
        nextAnnotations.length > 0 || defaults.id === null ? nextAnnotations : annotations,
      );
      setFormVersion((version) => version + 1);
      setMessage({
        kind: "success",
        text: `Imported ${file.name}. Review every field before saving.`,
      });
    } catch (error) {
      setMessage({
        kind: "error",
        text: error instanceof Error ? error.message : "Could not import that JSON draft.",
      });
    }
  };

  return (
    <>
      <section className={styles.section}>
        <h2 className={styles.sectionTitle}>Import frame draft</h2>
        <div className={styles.field}>
          <label className={styles.label} htmlFor="frameDraft">
            WBPP JSON
          </label>
          <input
            id="frameDraft"
            type="file"
            accept=".json,application/json"
            className={styles.input}
            onChange={importDraft}
          />
          <span className={styles.hint}>
            Populates this page only. Nothing is saved until you review and submit the form.
            {defaults.id !== null ? " The existing slug, publish state and images are kept." : ""}
          </span>
        </div>
        {message ? (
          <div
            className={message.kind === "error" ? styles.error : styles.success}
            role={message.kind === "error" ? "alert" : "status"}
            style={{ marginTop: 12 }}
          >
            {message.text}
          </div>
        ) : null}
      </section>

      <FrameForm
        key={formVersion}
        values={values}
        filters={filters}
        nights={nights}
        annotations={annotations}
        imageVariants={imageVariants}
        previewSrc={previewSrc}
        initialMessage={initialMessage}
      />
    </>
  );
}
