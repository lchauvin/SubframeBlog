# Deploying AstroBlog as a Hostinger Node.js app

This deployment runs the full Next.js application. `/admin`, uploads, image
derivatives and automatic annotations are available online; publishing no longer
requires a static export.

The app intentionally keeps SQLite and media on Hostinger's filesystem. Treat
that choice as provisional until the persistence test below passes.

## 1. Back up the current website

Before replacing an existing static website, download `public_html` and any
other data you need. Hostinger currently creates Node.js apps as a new website,
so follow hPanel's warning and backup instructions when attaching the domain.

## 2. Create persistent storage

In hPanel File Manager, create a private directory that is:

- writable by the Node.js application;
- outside the replaceable `domains/<domain>/nodejs` deployment directory;
- not directly exposed as a public URL.

Copy its exact absolute path from File Manager. A typical path may resemble
`/home/u123456789/astroblog-data`, but do not assume that path exists on your
account.

Set `ASTROBLOG_DATA_DIR` to that absolute path. The application refuses to start
in production if this variable is missing or resolves inside its working
deployment tree.

## 3. Create the Node.js website

In hPanel:

1. Add a **Node.js web app** and select Next.js.
2. Deploy from the Git repository or create a safe ZIP with:

   ```bash
   npm run package:hostinger
   ```

   This writes `astroblog-hostinger.zip` beside the project directory, with
   `package.json` at the archive root. It excludes dependencies, builds, local
   data, design assets and all real `.env` files.
3. Select Node.js 20 or 22.
4. Select the `build` script and `.next` output when hPanel asks.
5. Use the package `start` script if hPanel requests a start command; it runs
   `.next/standalone/server.js`.
6. Do not set `ASTROBLOG_EXPORT`.

Hostinger installs dependencies and starts the Next.js server. `sharp` and
`better-sqlite3` are native packages, so check the first build and runtime logs
for native-module errors.

## 4. Set environment variables

Add these in hPanel's deployment settings:

```text
ASTROBLOG_DATA_DIR=/absolute/private/path/from-file-manager
ASTROBLOG_SITE_URL=https://your-domain.example
ASTROMETRY_API_KEY=your_nova_astrometry_key
ASTROBLOG_ADMIN_USERNAME=admin
ASTROBLOG_ADMIN_PASSWORD=a-unique-password-of-at-least-12-characters
```

`ASTROBLOG_SITE_URL` is the public `https://` origin crawlers should see on
link previews. If you omit it, Open Graph image URLs are built from the request
Host header.

The first runtime start creates an empty migrated database and creates the admin
only if no admin exists. It never replaces an existing account.

After the first successful login:

1. remove `ASTROBLOG_ADMIN_PASSWORD` from hPanel;
2. optionally remove `ASTROBLOG_ADMIN_USERNAME`;
3. redeploy;
4. confirm the same credentials still work.

Never commit these values or import a real `.env` file into the repository.

## 5. Check readiness

- `/api/health/live` confirms the process is running.
- `/api/health/ready` confirms the DB, migrations, data/media directories and
  bundled deep-sky catalogue are available.
- `/admin/diagnostics` shows private storage details after login.

A readiness failure must be fixed before uploading real masters.

## 6. Mandatory persistence test

Hostinger's public Node.js documentation does not explicitly guarantee that an
arbitrary filesystem directory survives every deployment lifecycle. Before
launch:

1. create a draft frame in `/admin`;
2. upload a disposable test image and confirm derivatives appear;
3. record the data path and sizes from `/admin/diagnostics`;
4. redeploy the same application;
5. confirm the draft, image and diagnostics values remain;
6. make a small code-only deployment and confirm them again.

Only upload irreplaceable content after both redeployments pass. If either loses
data, stop and migrate SQLite/media to guaranteed persistent storage instead of
trying to work around the loss.

## 7. Automatic annotations

Uploading a master stores the Astrometry.net submission and advances it in
short, persistent steps. A process restart resumes queued/solving rows from
their saved submission or job ID. Opening the frame editor also advances a
pending solve.

The submitted 2048px derivative still leaves your server and reaches
nova.astrometry.net with `publicly_visible="n"`.

## 8. Backups

Use **Download database backup** in `/admin/diagnostics` for a consistent SQLite
snapshot. It does not include images.

Back up the complete `ASTROBLOG_DATA_DIR/media` directory with Hostinger's
hosting backup or File Manager tools. Keep at least one copy outside Hostinger.
Test restoring both the database and media locally before relying on the backup.

## 9. Updating image derivatives after a pipeline change

Derivatives are generated only when a master is uploaded, so a change to
`VARIANTS` in `src/server/media/derivatives.ts` — a new size, different chroma,
the Deep Zoom pyramid — reaches nothing already stored. Existing frames keep
serving their old derivatives; the site does not break, it just quietly does not
improve.

**You do not need to re-upload anything.** Masters live at
`ASTROBLOG_DATA_DIR/media/<slug>/master.*` on the server and survive
redeployment, so everything can be rebuilt in place.

Use **Image derivatives** on `/admin/diagnostics`. It lists which frames are
behind and why, and rebuilds them from the stored masters. It processes **one
frame per request**, because a 21 MP master takes a few seconds of `sharp` on
shared CPU and a single request covering every frame can time out halfway
through. Progress is shown per frame, and a run can be stopped and resumed —
each frame is independently idempotent.

Locally the equivalent is `npm run media:rederive [slug]`. That script is in the
deployment ZIP but runs through `tsx`, a devDependency shared hosting may not
install, which is why the admin control exists.

Before a bulk rebuild:

- **Check disk.** The pyramid adds roughly 5 MB per frame on top of the other
  derivatives.
- **Back up `ASTROBLOG_DATA_DIR/media`** (§8). A rebuild rewrites every
  derivative. Masters are never touched, so it is recoverable regardless, but
  the backup is cheap.

Schema changes needed by a new pipeline — `frame_tiles`, for the pyramid — are
applied automatically on the first boot after deploying, by the startup
migration in `instrumentation.ts`. There is no manual migration step.

## 10. Static export remains available

`npm run export` still creates `out/` for static-only hosting. That is a separate
deployment model: it excludes `/admin`, runtime media, health checks and server
actions. Do not upload `out/` over the Node.js web app.
