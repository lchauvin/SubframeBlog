"use client";

import { useActionState } from "react";
import { useFormStatus } from "react-dom";

import { RowEditor, type RowValue } from "@/components/admin/RowEditor";

import { saveSite, type FormState } from "../../actions";
import styles from "../../admin.module.css";

export type SiteFormValues = {
  siteName: string;
  siteTagline: string;
  navLogLabel: string;
  navAboutLabel: string;
  logHeading: string;
  logPaginationLabel: string;
  aboutKicker: string;
  aboutHeading: string;
  aboutBody: string;
  aboutRigLabel: string;
  aboutHeroSlug: string;
  aboutHeroCaption: string;
  printsLabel: string;
  printsBody: string;
  printsButtonLabel: string;
  contactHref: string;
  footerLeft: string;
  footerRight: string;
};

function SaveButton() {
  const { pending } = useFormStatus();
  return (
    <button type="submit" className={styles.buttonPrimary} disabled={pending}>
      {pending ? "Saving…" : "Save site settings"}
    </button>
  );
}

export function SiteForm({
  values,
  gear,
  stats,
  frameOptions,
}: {
  values: SiteFormValues;
  gear: RowValue[];
  stats: RowValue[];
  frameOptions: { slug: string; label: string }[];
}) {
  const [state, formAction] = useActionState<FormState, FormData>(saveSite, {});

  const field = (key: keyof SiteFormValues, label: string, hint?: string) => (
    <div className={styles.field} key={key}>
      <label className={styles.label} htmlFor={key}>
        {label}
      </label>
      <input id={key} name={key} className={styles.input} defaultValue={values[key]} />
      {hint ? <span className={styles.hint}>{hint}</span> : null}
    </div>
  );

  return (
    <form action={formAction}>
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
        <h2 className={styles.sectionTitle}>Header &amp; footer</h2>
        <div className={styles.grid2}>
          {field("siteName", "Site name", "Replaces the working title “Subframe”")}
          {field("siteTagline", "Tagline", "Sits beside the wordmark")}
          {field("navLogLabel", "Nav — log label")}
          {field("navAboutLabel", "Nav — about label")}
          {field("footerLeft", "Footer left")}
          {field("footerRight", "Footer right")}
        </div>
      </section>

      <section className={styles.section}>
        <h2 className={styles.sectionTitle}>The log</h2>
        <div className={styles.grid2}>
          {field("logHeading", "Heading")}
          {field(
            "logPaginationLabel",
            "Pagination button",
            "Leave blank to hide it — it is a non-functional placeholder",
          )}
        </div>
        <p className={styles.hint} style={{ marginTop: 10 }}>
          The subhead under the heading is computed from published frames, not edited here.
        </p>
      </section>

      <section className={styles.section}>
        <h2 className={styles.sectionTitle}>About page</h2>
        <div className={styles.grid2}>
          {field("aboutKicker", "Kicker")}
          {field("aboutRigLabel", "Rig list label")}

          <div className={`${styles.field} ${styles.fieldWide}`}>
            <label className={styles.label} htmlFor="aboutHeading">
              Heading
            </label>
            <textarea
              id="aboutHeading"
              name="aboutHeading"
              className={styles.textarea}
              style={{ minHeight: 70 }}
              defaultValue={values.aboutHeading}
            />
            <span className={styles.hint}>
              The line break is honoured — the design breaks it after “from”.
            </span>
          </div>

          <div className={`${styles.field} ${styles.fieldWide}`}>
            <label className={styles.label} htmlFor="aboutBody">
              Body
            </label>
            <textarea
              id="aboutBody"
              name="aboutBody"
              className={`${styles.textarea} ${styles.textareaTall}`}
              defaultValue={values.aboutBody}
            />
            <span className={styles.hint}>Blank line between paragraphs</span>
          </div>

          <div className={styles.field}>
            <label className={styles.label} htmlFor="aboutHeroSlug">
              Hero frame
            </label>
            <select
              id="aboutHeroSlug"
              name="aboutHeroSlug"
              className={styles.select}
              defaultValue={values.aboutHeroSlug}
            >
              <option value="">Newest published frame</option>
              {frameOptions.map((f) => (
                <option value={f.slug} key={f.slug}>
                  {f.label}
                </option>
              ))}
            </select>
          </div>

          {field("aboutHeroCaption", "Hero caption chip")}
        </div>
      </section>

      <section className={styles.section}>
        <h2 className={styles.sectionTitle}>Prints &amp; licensing card</h2>
        <div className={styles.grid2}>
          {field("printsLabel", "Card label")}
          {field("printsButtonLabel", "Button label")}
          <div className={`${styles.field} ${styles.fieldWide}`}>
            <label className={styles.label} htmlFor="printsBody">
              Card body
            </label>
            <textarea
              id="printsBody"
              name="printsBody"
              className={styles.textarea}
              style={{ minHeight: 80 }}
              defaultValue={values.printsBody}
            />
          </div>
          {field(
            "contactHref",
            "Contact link",
            "e.g. mailto:you@example.com — also used by the viewer's Print enquiry chip",
          )}
        </div>
      </section>

      <section className={styles.section}>
        <h2 className={styles.sectionTitle}>Current rig</h2>
        <RowEditor
          name="gearJson"
          initialRows={gear}
          addLabel="Add gear row"
          emptyLabel="No gear rows."
          blankRow={{ keyLabel: "", value: "" }}
          columns={[
            { key: "keyLabel", label: "Key", width: "0.6fr", placeholder: "Optics" },
            { key: "value", label: "Value", width: "2.4fr" },
          ]}
        />
        <p className={styles.hint} style={{ marginTop: 10 }}>
          Shown on the About page. New and existing frames use this list until you save
          per-frame equipment.
        </p>
      </section>

      <section className={styles.section}>
        <h2 className={styles.sectionTitle}>About stats</h2>
        <RowEditor
          name="statsJson"
          initialRows={stats}
          addLabel="Add stat"
          emptyLabel="No stats — the grid is hidden."
          blankRow={{ value: "", label: "" }}
          columns={[
            { key: "value", label: "Value", width: "0.6fr", placeholder: "612h" },
            { key: "label", label: "Label", width: "2.4fr", placeholder: "Total integration" },
          ]}
        />
        <p className={styles.hint} style={{ marginTop: 10 }}>
          Hand-edited. With the night log optional there is nothing to derive figures like
          “nights out” from. The design lays these out three across, so six reads best.
        </p>
      </section>

      <div className={styles.actions}>
        <SaveButton />
      </div>
    </form>
  );
}
