import "server-only";

import fs from "node:fs";
import fsp from "node:fs/promises";
import path from "node:path";

import { DATA_ROOT } from "../paths";

/**
 * Makes the constellation cards' label font available to the renderer.
 *
 * The labels are drawn by librsvg inside `sharp`, which finds fonts through
 * fontconfig — that is, through whatever is *installed on the machine doing the
 * rendering*. A developer laptop has hundreds of fonts and a bare Node host has
 * none, so the same code produced labelled cards locally and silently unlabelled
 * ones in production: the ruling drew (it is paths) and every glyph resolved to
 * nothing.
 *
 * The fix is to stop depending on the machine. One font ships with the app and
 * fontconfig is pointed at that directory and nothing else, so every renderer
 * sees exactly the same single family. That also means the local output is a
 * true rehearsal of the server's, which the previous arrangement was not.
 */

/** The family name inside the shipped file. Must match what the SVG asks for. */
export const CARD_FONT_FAMILY = "Roboto Mono";

const FONT_FILE = "RobotoMono-Regular.ttf";

/**
 * Where the shipped fonts are, or null if they did not make it into the
 * deployment.
 *
 * Resolved exactly the way the star and constellation catalogues are: relative
 * to the working directory first, then to the running script. The standalone
 * server runs from `.next/standalone`, so `scripts/build-server.mjs` copies
 * `assets` in beside `catalog` for precisely this reason.
 */
function fontsDir(): string | null {
  const candidates = [
    path.join(process.cwd(), "assets", "fonts"),
    process.argv[1] ? path.join(path.dirname(process.argv[1]), "assets", "fonts") : "",
  ].filter(Boolean);
  return candidates.find((dir) => fs.existsSync(path.join(dir, FONT_FILE))) ?? null;
}

/** Memoised: fontconfig reads its configuration once per process. */
let ready: Promise<boolean> | null = null;

async function configure(): Promise<boolean> {
  const dir = fontsDir();
  if (!dir) {
    console.warn(
      `[astroblog] ${FONT_FILE} is not in this deployment — constellation cards will be drawn without their grid labels.`,
    );
    return false;
  }

  // fontconfig wants a file it can read, and the font directory has to be an
  // absolute path inside it, so the config is written at runtime rather than
  // committed: the deployment path is not known until the app is running.
  const confDir = path.join(DATA_ROOT, "fontconfig");
  const confFile = path.join(confDir, "fonts.conf");
  const escaped = (value: string) =>
    value.replace(/&/g, "&amp;").replace(/</g, "&lt;").replace(/>/g, "&gt;");

  try {
    await fsp.mkdir(confDir, { recursive: true });
    await fsp.writeFile(
      confFile,
      [
        '<?xml version="1.0"?>',
        '<!DOCTYPE fontconfig SYSTEM "fonts.dtd">',
        "<fontconfig>",
        `  <dir>${escaped(dir)}</dir>`,
        `  <cachedir>${escaped(path.join(confDir, "cache"))}</cachedir>`,
        "</fontconfig>",
        "",
      ].join("\n"),
      "utf8",
    );
  } catch (error) {
    console.warn("[astroblog] Could not write the card font configuration.", error);
    return false;
  }

  // Only takes effect if it is set before the first glyph is rendered in this
  // process, which is why startup calls this and the card build calls it again.
  process.env.FONTCONFIG_FILE = confFile;
  return true;
}

/**
 * Points fontconfig at the shipped font. Safe to call repeatedly; the work
 * happens once.
 *
 * Resolves false when the font is missing, and the caller is expected to draw
 * the graticule without labels rather than emit a card whose text silently
 * failed to render — an unlabelled grid is a decision, an invisible one is a bug.
 */
export function ensureCardFonts(): Promise<boolean> {
  ready ??= configure();
  return ready;
}
