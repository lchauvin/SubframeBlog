"use client";

import { useMemo, useState } from "react";

import styles from "./RowEditor.module.css";

export type RowColumn = {
  key: string;
  label: string;
  type?: "text" | "number" | "date";
  step?: string;
  min?: number;
  max?: number;
  pattern?: string;
  title?: string;
  required?: boolean;
  width?: string;
  placeholder?: string;
};

export type RowValue = Record<string, string | number>;

/**
 * Repeatable rows serialised into one hidden JSON field. Simpler and far less
 * error-prone than indexed form-field names, and the server action just
 * JSON.parses it behind a zod array schema.
 */
export function RowEditor({
  name,
  columns,
  initialRows,
  rows: controlledRows,
  onRowsChange,
  serializeRows,
  blankRow,
  addLabel,
  emptyLabel = "No rows.",
}: {
  name: string;
  columns: RowColumn[];
  initialRows: RowValue[];
  rows?: RowValue[];
  onRowsChange?: (rows: RowValue[]) => void;
  serializeRows?: (rows: RowValue[]) => RowValue[];
  blankRow: RowValue;
  addLabel: string;
  emptyLabel?: string;
}) {
  const [localRows, setLocalRows] = useState<RowValue[]>(initialRows);
  const rows = controlledRows ?? localRows;

  const setRows = (update: (previous: RowValue[]) => RowValue[]) => {
    if (controlledRows !== undefined) {
      onRowsChange?.(update(controlledRows));
      return;
    }
    setLocalRows((previous) => {
      const next = update(previous);
      onRowsChange?.(next);
      return next;
    });
  };

  const template = useMemo(
    () => `${columns.map((c) => c.width ?? "1fr").join(" ")} 60px`,
    [columns],
  );

  const update = (index: number, key: string, value: string) =>
    setRows((prev) => prev.map((r, i) => (i === index ? { ...r, [key]: value } : r)));

  const move = (index: number, delta: number) =>
    setRows((prev) => {
      const next = [...prev];
      const target = index + delta;
      if (target < 0 || target >= next.length) return prev;
      [next[index], next[target]] = [next[target], next[index]];
      return next;
    });

  return (
    <div>
      <input
        type="hidden"
        name={name}
        value={JSON.stringify(serializeRows ? serializeRows(rows) : rows)}
      />

      <div className={styles.wrap}>
        <div className={styles.head} style={{ gridTemplateColumns: template }}>
          {columns.map((c) => (
            <span className={styles.headCell} key={c.key}>
              {c.label}
            </span>
          ))}
          <span />
        </div>

        {rows.length === 0 ? <div className={styles.empty}>{emptyLabel}</div> : null}

        {rows.map((row, i) => (
          <div className={styles.row} key={i} style={{ gridTemplateColumns: template }}>
            {columns.map((c) => (
              <input
                key={c.key}
                className={styles.input}
                type={c.type ?? "text"}
                step={c.step}
                min={c.min}
                max={c.max}
                pattern={c.pattern}
                title={c.title}
                required={c.required}
                placeholder={c.placeholder}
                value={String(row[c.key] ?? "")}
                onChange={(e) => update(i, c.key, e.target.value)}
                aria-label={c.label}
              />
            ))}
            <span className={styles.controls}>
              <button
                type="button"
                className={styles.iconButton}
                onClick={() => move(i, -1)}
                disabled={i === 0}
                aria-label="Move up"
              >
                ↑
              </button>
              <button
                type="button"
                className={`${styles.iconButton} ${styles.remove}`}
                onClick={() => setRows((prev) => prev.filter((_, j) => j !== i))}
                aria-label="Remove row"
              >
                ×
              </button>
            </span>
          </div>
        ))}
      </div>

      <div className={styles.footer}>
        <button
          type="button"
          className={styles.add}
          onClick={() => setRows((prev) => [...prev, { ...blankRow }])}
        >
          {addLabel}
        </button>
      </div>
    </div>
  );
}
