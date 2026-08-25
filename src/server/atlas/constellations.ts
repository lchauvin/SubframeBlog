import "server-only";

import fs from "node:fs";
import path from "node:path";

import { angularSeparation } from "../astrometry/wcs";

/**
 * Constellation stick figures for the sky atlas.
 *
 * Scenery, like the star backdrop: these are drawn to make a region
 * recognisable and are never matched against a frame. Each figure is already
 * stored as coordinate polylines, so nothing here has to resolve star
 * identifiers at render time.
 */

export type ConstellationFigure = {
  id: string;
  name: string;
  /** Polylines of [raDeg, decDeg] vertices. */
  lines: [number, number][][];
};

type ConstellationFile = {
  generated: string;
  count: number;
  constellations: ConstellationFigure[];
};

let cache: ConstellationFile | null = null;

function constellationsPath(): string {
  const candidates = [
    path.join(process.cwd(), "catalog", "constellations.json"),
    process.argv[1]
      ? path.join(path.dirname(process.argv[1]), "catalog", "constellations.json")
      : "",
  ].filter(Boolean);
  return candidates.find((candidate) => fs.existsSync(candidate)) ?? candidates[0];
}

export const constellationsAvailable = () => fs.existsSync(constellationsPath());

export function loadConstellations(): ConstellationFile {
  if (cache) return cache;
  cache = JSON.parse(fs.readFileSync(constellationsPath(), "utf8")) as ConstellationFile;
  return cache;
}

/**
 * Figures with at least one vertex near the panel.
 *
 * A generous cone rather than an exact test: a figure whose vertices all fall
 * outside can still have a limb crossing the panel, and dropping it would break
 * a line mid-air. The projection clips whatever actually leaves the frame.
 */
export function constellationsWithin(
  centre: { ra: number; dec: number },
  radiusDeg: number,
): ConstellationFigure[] {
  if (!constellationsAvailable()) return [];

  const reach = radiusDeg + 25;
  return loadConstellations().constellations.filter((figure) =>
    figure.lines.some((line) =>
      line.some(([ra, dec]) => angularSeparation(centre.ra, centre.dec, ra, dec) <= reach),
    ),
  );
}
