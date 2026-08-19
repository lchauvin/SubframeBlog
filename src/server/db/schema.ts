import { sql } from "drizzle-orm";
import {
  index,
  integer,
  real,
  sqliteTable,
  text,
  uniqueIndex,
} from "drizzle-orm/sqlite-core";

const now = sql`(unixepoch())`;

/**
 * One published frame (one target). `capturedOn` is an ISO date — the prototype
 * carried only "Jul 2026" display strings and so could not actually sort the
 * "newest first" order the gallery claims.
 */
export const frames = sqliteTable(
  "frames",
  {
    id: integer("id").primaryKey({ autoIncrement: true }),
    slug: text("slug").notNull(),
    catalogId: text("catalog_id").notNull(),
    commonName: text("common_name").notNull().default(""),

    frameNumber: text("frame_number").notNull().default(""),
    revision: text("revision").notNull().default(""),

    capturedOn: text("captured_on").notNull(), // YYYY-MM-DD
    palette: text("palette").notNull().default("HOO"),
    bandwidth: text("bandwidth").notNull().default("3nm"),

    /** Authoritative, hand-entered. Nights are optional detail and never roll up. */
    totalIntegrationMinutes: integer("total_integration_minutes").notNull().default(0),

    metaLine: text("meta_line").notNull().default(""),
    blurb: text("blurb").notNull().default(""),
    bodyMarkdown: text("body_markdown").notNull().default(""),
    note: text("note").notNull().default(""),

    // The eight spec-plate cells. Fixed by the design — the README is explicit
    // that the four earlier cells were removed deliberately and must not return.
    plateCatalog: text("plate_catalog").notNull().default(""),
    plateClass: text("plate_class").notNull().default(""),
    plateConstellation: text("plate_constellation").notNull().default(""),
    plateDistance: text("plate_distance").notNull().default(""),
    plateCoordinates: text("plate_coordinates").notNull().default(""),
    platePalette: text("plate_palette").notNull().default(""),
    plateSessions: text("plate_sessions").notNull().default(""),
    plateSky: text("plate_sky").notNull().default(""),

    // Viewer / overlay chip data.
    opticsLabel: text("optics_label").notNull().default(""),
    sensorLabel: text("sensor_label").notNull().default(""),
    arcsecPerPx: real("arcsec_per_px"),

    published: integer("published", { mode: "boolean" }).notNull().default(false),
    sortIndex: integer("sort_index").notNull().default(0),

    createdAt: integer("created_at", { mode: "timestamp" }).notNull().default(now),
    updatedAt: integer("updated_at", { mode: "timestamp" }).notNull().default(now),
  },
  (t) => [
    uniqueIndex("frames_slug_idx").on(t.slug),
    index("frames_captured_on_idx").on(t.capturedOn),
  ],
);

/**
 * One row per generated derivative. Dimensions are probed from the file, never
 * assumed: the five design masters are not all the same size (ic1848 is
 * 5983x3347 where the rest are 5983x3499) yet the prototype hardcodes one pair.
 */
export const frameImages = sqliteTable(
  "frame_images",
  {
    id: integer("id").primaryKey({ autoIncrement: true }),
    frameId: integer("frame_id")
      .notNull()
      .references(() => frames.id, { onDelete: "cascade" }),
    variant: text("variant").notNull(), // master | viewer | article | thumb
    format: text("format").notNull(), // jpeg | webp
    path: text("path").notNull(), // relative to the media root
    width: integer("width").notNull(),
    height: integer("height").notNull(),
    bytes: integer("bytes").notNull().default(0),
    createdAt: integer("created_at", { mode: "timestamp" }).notNull().default(now),
  },
  (t) => [
    uniqueIndex("frame_images_variant_idx").on(t.frameId, t.variant, t.format),
    index("frame_images_frame_idx").on(t.frameId),
  ],
);

/**
 * Per-filter integration. Stored and authoritative — bar geometry is derived
 * from these at render time, but nothing recomputes them from `nights`.
 */
export const frameFilters = sqliteTable(
  "frame_filters",
  {
    id: integer("id").primaryKey({ autoIncrement: true }),
    frameId: integer("frame_id")
      .notNull()
      .references(() => frames.id, { onDelete: "cascade" }),
    position: integer("position").notNull().default(0),
    name: text("name").notNull(), // "Hα 3nm"
    subLengthSeconds: integer("sub_length_seconds").notNull().default(0),
    keptFrames: integer("kept_frames").notNull().default(0),
    totalFrames: integer("total_frames").notNull().default(0),
    hours: real("hours").notNull().default(0),
  },
  (t) => [index("frame_filters_frame_idx").on(t.frameId)],
);

/** Optional per-night detail. Display only; no totals are derived from it. */
export const nights = sqliteTable(
  "nights",
  {
    id: integer("id").primaryKey({ autoIncrement: true }),
    frameId: integer("frame_id")
      .notNull()
      .references(() => frames.id, { onDelete: "cascade" }),
    position: integer("position").notNull().default(0),
    nightDate: text("night_date").notNull(), // YYYY-MM-DD
    filterLabel: text("filter_label").notNull().default(""), // "Hα"
    subLengthSeconds: integer("sub_length_seconds").notNull().default(0),
    kept: integer("kept").notNull().default(0),
    rejected: integer("rejected").notNull().default(0),
    reason: text("reason").notNull().default("—"),
  },
  (t) => [index("nights_frame_idx").on(t.frameId)],
);

/**
 * Viewer annotation markers. Per frame — the prototype reused a single global
 * five-marker array for every image, so four of five targets showed labels for
 * objects that are not in the frame.
 */
export const annotations = sqliteTable(
  "annotations",
  {
    id: integer("id").primaryKey({ autoIncrement: true }),
    frameId: integer("frame_id")
      .notNull()
      .references(() => frames.id, { onDelete: "cascade" }),
    position: integer("position").notNull().default(0),
    label: text("label").notNull(),
    xPct: real("x_pct").notNull(),
    yPct: real("y_pct").notNull(),
    /**
     * Circle diameter in "design pixels" — px at the design's nominal 1600px
     * image width. The viewer scales it by (displayed width / 1600) so a marker
     * encloses the same patch of sky on any screen. The design's 22–54px range
     * is authored in exactly these units.
     */
    radiusPx: real("radius_px").notNull().default(28),
    /** manual | auto — `auto` rows came from a plate solve and want reviewing. */
    source: text("source").notNull().default("manual"),
  },
  (t) => [index("annotations_frame_idx").on(t.frameId)],
);

/**
 * One plate-solve attempt per frame (latest wins). Kept separate from `frames`
 * so a solve can be re-run, and so its status can be polled by the admin
 * without touching the frame record.
 */
export const plateSolves = sqliteTable(
  "plate_solves",
  {
    id: integer("id").primaryKey({ autoIncrement: true }),
    frameId: integer("frame_id")
      .notNull()
      .references(() => frames.id, { onDelete: "cascade" }),
    // queued | solving | solved | failed
    status: text("status").notNull().default("queued"),
    submissionId: text("submission_id").notNull().default(""),
    jobId: text("job_id").notNull().default(""),

    // Calibration returned by the solver, kept so annotations can be
    // regenerated later without re-uploading.
    centerRa: real("center_ra"),
    centerDec: real("center_dec"),
    radiusDeg: real("radius_deg"),
    pixScale: real("pix_scale"),
    orientation: real("orientation"),

    /**
     * The full solved WCS as JSON (CRVAL/CRPIX/CD matrix + image size). Kept so
     * markers can be regenerated — after a catalogue update, say — without
     * re-uploading the image or re-solving.
     */
    wcsJson: text("wcs_json").notNull().default(""),

    objectsFound: integer("objects_found").notNull().default(0),
    annotationsWritten: integer("annotations_written").notNull().default(0),
    message: text("message").notNull().default(""),

    createdAt: integer("created_at", { mode: "timestamp" }).notNull().default(now),
    updatedAt: integer("updated_at", { mode: "timestamp" }).notNull().default(now),
  },
  (t) => [uniqueIndex("plate_solves_frame_idx").on(t.frameId)],
);

/** Site-level gear list; renders in both the article sidebar and /about. */
export const gearItems = sqliteTable("gear_items", {
  id: integer("id").primaryKey({ autoIncrement: true }),
  position: integer("position").notNull().default(0),
  keyLabel: text("key_label").notNull(),
  value: text("value").notNull(),
});

/**
 * The six About cells. Hand-edited: with the night log optional, figures like
 * "187 nights out" have no derivable source.
 */
export const siteStats = sqliteTable("site_stats", {
  id: integer("id").primaryKey({ autoIncrement: true }),
  position: integer("position").notNull().default(0),
  value: text("value").notNull(),
  label: text("label").notNull(),
});

/** Singleton row (id = 1). */
export const siteSettings = sqliteTable("site_settings", {
  id: integer("id").primaryKey({ autoIncrement: true }),

  siteName: text("site_name").notNull().default("Subframe"),
  siteTagline: text("site_tagline").notNull().default("MTL / Bortle 9"),

  navLogLabel: text("nav_log_label").notNull().default("The log"),
  navAboutLabel: text("nav_about_label").notNull().default("About & rig"),

  logHeading: text("log_heading").notNull().default("The log"),
  logPaginationLabel: text("log_pagination_label").notNull().default(""),

  aboutKicker: text("about_kicker").notNull().default("About"),
  aboutHeading: text("about_heading").notNull().default(""),
  aboutBody: text("about_body").notNull().default(""),
  aboutRigLabel: text("about_rig_label").notNull().default("Current rig"),
  aboutHeroSlug: text("about_hero_slug").notNull().default(""),
  aboutHeroCaption: text("about_hero_caption").notNull().default(""),

  printsLabel: text("prints_label").notNull().default("Prints & licensing"),
  printsBody: text("prints_body").notNull().default(""),
  printsButtonLabel: text("prints_button_label").notNull().default("Get in touch"),
  contactHref: text("contact_href").notNull().default(""),

  footerLeft: text("footer_left").notNull().default(""),
  footerRight: text("footer_right").notNull().default(""),

  updatedAt: integer("updated_at", { mode: "timestamp" }).notNull().default(now),
});

/** Single-user admin. Rows are created by `npm run admin:password`, never by a signup form. */
export const adminUsers = sqliteTable(
  "admin_users",
  {
    id: integer("id").primaryKey({ autoIncrement: true }),
    username: text("username").notNull(),
    passwordHash: text("password_hash").notNull(),
    createdAt: integer("created_at", { mode: "timestamp" }).notNull().default(now),
    lastLoginAt: integer("last_login_at", { mode: "timestamp" }),
  },
  (t) => [uniqueIndex("admin_users_username_idx").on(t.username)],
);

/** Server-side sessions. Named to avoid colliding with acquisition "sessions" (see `nights`). */
export const authSessions = sqliteTable(
  "auth_sessions",
  {
    id: text("id").primaryKey(), // random 256-bit token, hex
    userId: integer("user_id")
      .notNull()
      .references(() => adminUsers.id, { onDelete: "cascade" }),
    expiresAt: integer("expires_at", { mode: "timestamp" }).notNull(),
    createdAt: integer("created_at", { mode: "timestamp" }).notNull().default(now),
  },
  (t) => [index("auth_sessions_user_idx").on(t.userId)],
);

export type Frame = typeof frames.$inferSelect;
export type FrameImage = typeof frameImages.$inferSelect;
export type FrameFilter = typeof frameFilters.$inferSelect;
export type Night = typeof nights.$inferSelect;
export type Annotation = typeof annotations.$inferSelect;
export type GearItem = typeof gearItems.$inferSelect;
export type SiteStat = typeof siteStats.$inferSelect;
export type SiteSettings = typeof siteSettings.$inferSelect;
export type AdminUser = typeof adminUsers.$inferSelect;
export type PlateSolve = typeof plateSolves.$inferSelect;
