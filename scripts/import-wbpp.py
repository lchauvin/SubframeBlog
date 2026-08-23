#!/usr/bin/env python3
"""Build a reviewable AstroBlog frame draft from one or more PixInsight WBPP logs."""

from __future__ import annotations

import argparse
import csv
import io
import json
import math
import os
import re
import sys
import urllib.error
import urllib.parse
import urllib.request
from collections import Counter, defaultdict
from dataclasses import dataclass
from datetime import date
from pathlib import Path, PureWindowsPath
from typing import Any, Iterable


TIMESTAMP_RE = re.compile(r"^\[[^\]]+\]\s*")
GROUP_RE = re.compile(r"Group of (\d+) Light frames \((\d+) active\)", re.I)
FILTER_RE = re.compile(r"Filter\s*:\s*(.+?)\s*$", re.I)
EXPOSURE_RE = re.compile(r"Exposure\s*:\s*([0-9.]+)s", re.I)
NIGHT_RE = re.compile(r"Keywords\s*:\s*\[NIGHT:\s*(\d{4}-\d{2}-\d{2})\]", re.I)
CACHE_COORD_RE = re.compile(
    r"ra=([0-9.]+)\s+deg\s+dec=([+-]?[0-9.]+)\s+deg\s+xpixsz=([0-9.]+)\s+um",
    re.I,
)
CENTER_RE = re.compile(
    r"Center coordinates:\s*RA\s*=\s*([0-9 ]+\.[0-9]+),\s*Dec\s*=\s*([+-][0-9 ]+\.[0-9]+)",
    re.I,
)
RESOLUTION_RE = re.compile(r"Resolution:\s*([0-9.]+)\s*as/px", re.I)
PATH_RE = re.compile(r'"([^"]+\.(?:fits?|xisf|xdrz))"', re.I)
SOURCE_PATH_RE = re.compile(r"([A-Za-z]:[/\\][^\r\n]*?\.fits?)", re.I)
LIGHT_NAME_RE = re.compile(
    r"^(?:BAD_)?(?P<date>\d{4}-\d{2}-\d{2})_(?P<time>\d{2}-\d{2}-\d{2})_+"
    r"(?P<filter>[A-Za-z0-9]+)_(?P<temp>[+-]?\d+(?:\.\d+)?)_"
    r"(?P<exposure>\d+(?:\.\d+)?)s_+(?P<seq>\d+)",
    re.I,
)
PIPELINE_DIR_RE = re.compile(r"^(\d+)\.\s+")
NIGHT_DIR_RE = re.compile(r"^\d{4}-\d{2}-\d{2}$")
YEAR_DIR_RE = re.compile(r"^\d{4}$")
SESSION_DIR_NAME = ".SessionData"
IGNORE_WALK_DIRS = {".finished", ".calibration", "referenceframe", "flat"}
LIGHT_EXTS = {".fit", ".fits", ".xisf", ".xnml"}
MAX_PER_FRAME_STEP = 6

DEFAULT_SIMBAD_URL = "https://simbad.cds.unistra.fr/simbad/sim-tap/sync"
DEFAULT_WIKIDATA_URL = "https://www.wikidata.org/w/api.php"
DEFAULT_WIKIPEDIA_URL = "https://en.wikipedia.org/w/api.php"
HTTP_USER_AGENT = "AstroBlog-WBPP/1 (local astrophotography draft importer)"
DEFAULT_OLLAMA_HOST = "http://localhost:11434"
PREFERRED_OLLAMA_MODELS = (
    "llama3.2:latest",
    "llama3.2",
    "llama3.1:8b",
    "llama3.1",
    "llama3",
)
DEFAULT_OPTICS_LABEL = "RedCat 51 WIFD"
DEFAULT_SENSOR_LABEL = "QHY Minicam8M (IMX585)"
DEFAULT_SKY_LABEL = "Bortle 9"
FOCAL_LENGTH_MM = 250.0
PIXEL_SIZE_UM = 2.9
ARCSEC_PER_RADIAN_UM_MM = 206.265
PC_TO_LY = 3.261563777
INFOBOX_DISTANCE_RE = re.compile(
    r"^\s*\|\s*(dist_ly|dist_pc|dist_kpc|distance)[ \t]*=[ \t]*(.*)$",
    re.I | re.M,
)
CONVERT_TEMPLATE_RE = re.compile(
    r"\{\{\s*convert\s*\|\s*([0-9][0-9,]*(?:\.[0-9]+)?)\s*\|\s*([^}|]+)",
    re.I,
)
ALSO_KNOWN_AS_RE = re.compile(
    r"(?:also|commonly)\s+known\s+as\s+(?:the\s+)?(?:'{2,3})?([^'|\n]+?)(?:'{2,3})?"
    r"(?=\s*\)|\s*\.|\s*,|\s*$)",
    re.I,
)
CATALOG_ID_RE = re.compile(
    r"""(?ix)^(?:NAME\s+)?(?:
        SH(?:ARPLESS)?\s*2[- ]?\d
        | NGC\s*\d
        | IC\s*\d
        | HD\s*\d
        | HR\s*\d
        | BD\s*[+\-]?\d
        | CD\s*[+\-]?\d
        | LBN\s*\d
        | LDN\s*\d
        | WR\s*\d
        | M\s*\d
        | UGC\s*\d
        | PGC\s*\d
        | HIP\s*\d
        | V\*
        | [A-Za-z]{1,5}\d
    )""",
)
WIKIDATA_DISTANCE_UNITS = {
    "Q12129": "pc",  # parsec
    "Q180892": "kpc",  # kiloparsec
    "Q38552": "Mpc",  # megaparsec
    "Q531": "ly",  # light-year
}
MONTHS = ["Jan", "Feb", "Mar", "Apr", "May", "Jun",
          "Jul", "Aug", "Sep", "Oct", "Nov", "Dec"]


@dataclass(frozen=True)
class Group:
    filter_name: str
    exposure: float
    total: int
    active: int
    night: str | None = None


@dataclass
class PendingGroup:
    total: int
    active: int
    filter_name: str | None = None
    exposure: float | None = None
    night: str | None = None

    def complete(self) -> bool:
        return self.filter_name is not None and self.exposure is not None

    def freeze(self) -> Group:
        assert self.filter_name is not None and self.exposure is not None
        return Group(self.filter_name, self.exposure, self.total, self.active, self.night)


@dataclass
class ParseResult:
    wbpp_version: str | None
    calibration_groups: list[Group]
    integration_groups: list[Group]
    kept_by_night: Counter[tuple[str, str]]
    center_ra: str | None
    center_dec: str | None
    center_ra_deg: float | None
    center_dec_deg: float | None
    pixel_size_um: float | None
    arcsec_per_px: float | None
    warnings: list[str]


def clean_line(raw: str) -> str:
    return TIMESTAMP_RE.sub("", raw).strip()


def plate_scale_arcsec_per_px(
    focal_length_mm: float = FOCAL_LENGTH_MM,
    pixel_size_um: float = PIXEL_SIZE_UM,
) -> float:
    if focal_length_mm <= 0:
        return 0.0
    return round((pixel_size_um / focal_length_mm) * ARCSEC_PER_RADIAN_UM_MM, 3)


def normalized_stem(path_text: str) -> str:
    name = PureWindowsPath(path_text.replace("/", "\\")).name
    stem = re.sub(r"\.(?:fits?|xisf|xdrz)$", "", name, flags=re.I)
    return re.sub(r"(?:_c)?_r$", "", stem, flags=re.I)


def normalize_filter(name: str) -> str:
    compact = re.sub(r"[^a-z0-9]+", "", name.casefold())
    aliases = {
        "ha": "Ha",
        "h": "Ha",
        "halpha": "Ha",
        "hydrogenalpha": "Ha",
        "oiii": "OIII",
        "o3": "OIII",
        "o": "OIII",
        "oxygeniii": "OIII",
        "sii": "SII",
        "s2": "SII",
        "s": "SII",
        "sulfurii": "SII",
        "sulphurii": "SII",
        "l": "L",
        "lum": "L",
        "luminance": "L",
        "r": "R",
        "red": "R",
        "g": "G",
        "green": "G",
        "b": "B",
        "blue": "B",
        "rgb": "RGB",
    }
    return aliases.get(compact, name.strip())


def display_filter(name: str, bandwidth: str) -> str:
    base = {"Ha": "Hα", "OIII": "OIII", "SII": "SII"}.get(name, name)
    if bandwidth and name in {"Ha", "OIII", "SII"}:
        return f"{base} {bandwidth}"
    return base


def infer_palette(filters: Iterable[str]) -> str:
    found = set(filters)
    if {"Ha", "OIII", "SII"} <= found:
        return "SHO"
    if {"Ha", "OIII"} <= found:
        return "HOO"
    if {"L", "R", "G", "B"} <= found:
        return "LRGB"
    if {"R", "G", "B"} <= found or "RGB" in found:
        return "RGB"
    narrowband = [f for f in ("Ha", "OIII", "SII") if f in found]
    return "+".join(narrowband or sorted(found))


def filter_sort_key(item: tuple[str, float]) -> tuple[int, str, float]:
    name, exposure = item
    order = {
        "SII": 0,
        "Ha": 1,
        "OIII": 2,
        "L": 3,
        "R": 4,
        "G": 5,
        "B": 6,
        "RGB": 7,
    }
    return order.get(name, 100), name.casefold(), exposure


def _unique_groups(groups: Iterable[Group]) -> list[Group]:
    seen: set[Group] = set()
    result: list[Group] = []
    for group in groups:
        if group not in seen:
            seen.add(group)
            result.append(group)
    return result


def best_integration_groups(groups: Iterable[Group]) -> dict[tuple[str, float], Group]:
    best: dict[tuple[str, float], Group] = {}
    for group in groups:
        key = (group.filter_name, group.exposure)
        if key not in best or group.total > best[key].total:
            best[key] = group
    return best


def as_log_paths(value: Path | str | Iterable[Path | str]) -> list[Path]:
    if isinstance(value, (str, Path)):
        return [Path(value)]
    return [Path(item) for item in value]


def source_kind(path: Path) -> str:
    if path.exists():
        return "dir" if path.is_dir() else "log"
    if path.suffix.lower() == ".log":
        return "log"
    return "dir"


def unique_log_paths(paths: Iterable[Path]) -> list[Path]:
    seen: set[str] = set()
    unique: list[Path] = []
    for path in paths:
        try:
            key = str(path.resolve())
        except OSError:
            key = str(path)
        if key not in seen:
            seen.add(key)
            unique.append(path)
    return unique


def log_labels(paths: Iterable[Path]) -> list[str]:
    items = list(paths)
    labels: list[str] = []
    for path in items:
        if path.exists() and path.is_dir() and path.parent.name:
            labels.append(f"{path.parent.name}/{path.name}")
        else:
            labels.append(path.name)
    if len(labels) == len(set(labels)):
        return labels
    return [f"{path.parent.name}/{path.name}" for path in items]


def angular_separation_deg(ra1: float, dec1: float, ra2: float, dec2: float) -> float:
    r1, d1, r2, d2 = (math.radians(value) for value in (ra1, dec1, ra2, dec2))
    cos_c = math.sin(d1) * math.sin(d2) + math.cos(d1) * math.cos(d2) * math.cos(r1 - r2)
    return math.degrees(math.acos(max(-1.0, min(1.0, cos_c))))


def parse_wbpp_log(path: Path) -> ParseResult:
    stage = ""
    pending: PendingGroup | None = None
    calibration_groups: list[Group] = []
    integration_groups: list[Group] = []
    source_frames: dict[str, tuple[str, str]] = {}
    integrated_keys: set[tuple[str, str]] = set()
    kept_by_night: Counter[tuple[str, str]] = Counter()
    wbpp_version: str | None = None
    center_ra = center_dec = None
    center_ra_deg = center_dec_deg = pixel_size_um = None
    resolutions: list[float] = []
    warnings: list[str] = []

    def flush() -> None:
        nonlocal pending
        if pending and pending.complete():
            group = pending.freeze()
            if stage == "calibrate_light":
                calibration_groups.append(group)
            elif stage == "integrate_light":
                integration_groups.append(group)
        pending = None

    with path.open("r", encoding="utf-8-sig", errors="replace") as handle:
        for raw in handle:
            line = clean_line(raw)
            if not line:
                continue

            version = re.search(r"Weighted Batch Preprocessing\s+([0-9.]+)", line, re.I)
            if version:
                wbpp_version = version.group(1)

            lower = line.casefold()
            if "begin calibration of light frames" in lower or "light frames calibration" in lower:
                flush()
                stage = "calibrate_light"
                continue
            if "begin integration of light frames" in lower or (
                "image integration" in lower and "drizzle" not in lower
            ):
                flush()
                stage = "integrate_light"
                continue
            if (
                "begin drizzle integration" in lower
                or "drizzle integration" in lower
                or "begin calibration of flat" in lower
                or "flat frames calibration" in lower
                or "master flat integration" in lower
                or "image registration" in lower
                or "local normalization" in lower
                or "astrometric solution" in lower
            ):
                flush()
                stage = "other"
                continue
            if lower.startswith("* begin ") or lower.startswith("* end "):
                flush()
                stage = "other"
                continue

            match = GROUP_RE.search(line)
            if match:
                flush()
                pending = PendingGroup(int(match.group(1)), int(match.group(2)))
                continue

            if pending:
                match = FILTER_RE.search(line)
                if match:
                    pending.filter_name = normalize_filter(match.group(1))
                    continue
                match = EXPOSURE_RE.search(line)
                if match:
                    pending.exposure = float(match.group(1))
                    continue
                match = NIGHT_RE.search(line)
                if match:
                    pending.night = match.group(1)
                    continue

            # Map original light basenames back to WBPP's NIGHT keyword. This
            # preserves session dates for exposures taken after midnight.
            if stage == "calibrate_light" and pending and pending.night and pending.filter_name:
                source_match = SOURCE_PATH_RE.search(line)
                if source_match:
                    source_frames[normalized_stem(source_match.group(1))] = (
                        pending.night,
                        pending.filter_name,
                    )

            # Count the exact frames enabled in the final ImageIntegration input.
            if stage == "integrate_light" and pending and pending.filter_name and "[true," in line:
                path_match = PATH_RE.search(line)
                if path_match:
                    stem = normalized_stem(path_match.group(1))
                    key = (pending.filter_name, stem)
                    if key not in integrated_keys:
                        integrated_keys.add(key)
                        source = source_frames.get(stem)
                        if source:
                            kept_by_night[source] += 1

            match = CACHE_COORD_RE.search(line)
            if match:
                center_ra_deg = float(match.group(1))
                center_dec_deg = float(match.group(2))
                # Ignore the synthetic half-size pixels reported for 2x drizzle.
                pixel_size_um = max(pixel_size_um or 0.0, float(match.group(3)))
            match = CENTER_RE.search(line)
            if match:
                center_ra, center_dec = match.group(1), match.group(2)
            match = RESOLUTION_RE.search(line)
            if match:
                resolutions.append(float(match.group(1)))

    flush()
    calibration_groups = _unique_groups(calibration_groups)
    integration_groups = _unique_groups(integration_groups)

    if not calibration_groups:
        warnings.append("No light-frame calibration groups were found.")
    if not integration_groups:
        warnings.append("No final light ImageIntegration groups were found.")

    expected_by_filter = best_integration_groups(integration_groups)
    expected_kept = sum(group.active for group in expected_by_filter.values())
    mapped_kept = sum(kept_by_night.values())
    if mapped_kept and mapped_kept != expected_kept:
        warnings.append(
            f"Mapped {mapped_kept} of {expected_kept} integrated frames to NIGHT sessions; "
            "night rows are incomplete."
        )

    return ParseResult(
        wbpp_version=wbpp_version,
        calibration_groups=calibration_groups,
        integration_groups=integration_groups,
        kept_by_night=kept_by_night,
        center_ra=center_ra,
        center_dec=center_dec,
        center_ra_deg=center_ra_deg,
        center_dec_deg=center_dec_deg,
        pixel_size_um=pixel_size_um,
        arcsec_per_px=max(resolutions) if resolutions else None,
        warnings=warnings,
    )


def is_processing_dir(path: Path) -> bool:
    if not path.is_dir():
        return False
    try:
        names = [child.name for child in path.iterdir()]
    except OSError:
        return False
    lowered = {name.casefold() for name in names}
    if SESSION_DIR_NAME.casefold() in lowered:
        return True
    return any(PIPELINE_DIR_RE.match(name) for name in names)


def parse_light_filename(name: str) -> re.Match[str] | None:
    return LIGHT_NAME_RE.match(Path(name).stem)


def capture_id(name: str) -> str | None:
    match = parse_light_filename(name)
    if not match:
        return None
    return (
        f"{match['date']}_{match['time']}__{match['filter']}_{match['temp']}_"
        f"{match['exposure']}s__{match['seq']}"
    )


def night_from_parent(path: Path) -> str | None:
    for part in path.parts:
        if NIGHT_DIR_RE.match(part):
            return part
    return None


def iter_frame_files(folder: Path) -> list[Path]:
    files: list[Path] = []
    if not folder.is_dir():
        return files
    for dirpath, dirnames, filenames in os.walk(folder):
        dirnames[:] = [name for name in dirnames if name.casefold() not in IGNORE_WALK_DIRS]
        for filename in filenames:
            if Path(filename).suffix.lower() in LIGHT_EXTS:
                files.append(Path(dirpath) / filename)
    return files


def unique_capture_files(
    files: Iterable[Path],
    default_filter: str,
) -> list[tuple[str, str, float, str | None, str | None]]:
    seen: set[str] = set()
    records: list[tuple[str, str, float, str | None, str | None]] = []
    for path in files:
        match = parse_light_filename(path.name)
        if match:
            key = capture_id(path.name) or str(path)
            exposure = float(match["exposure"])
            filt = default_filter or normalize_filter(match["filter"])
            stamp_date = match["date"]
        else:
            continue
        if not filt or key in seen:
            continue
        seen.add(key)
        records.append((key, filt, exposure, night_from_parent(path), stamp_date))
    return records


def pipeline_dirs(root: Path) -> list[tuple[int, Path]]:
    found: list[tuple[int, Path]] = []
    for child in root.iterdir():
        if not child.is_dir():
            continue
        match = PIPELINE_DIR_RE.match(child.name)
        if match:
            found.append((int(match.group(1)), child))
    return sorted(found)


def filter_subdir(stage: Path, filter_name: str) -> Path | None:
    if not stage.is_dir():
        return None
    for child in stage.iterdir():
        if child.is_dir() and normalize_filter(child.name) == filter_name:
            return child
    return None


def parse_input(path: Path) -> ParseResult:
    if path.is_dir():
        return parse_processing_dir(path)
    return parse_wbpp_log(path)


def parse_processing_dir(root: Path) -> ParseResult:
    warnings: list[str] = []
    calibration_groups: list[Group] = []
    session_index: dict[str, tuple[str, str, float]] = {}
    session = root / SESSION_DIR_NAME

    session_light_files = 0
    if session.is_dir():
        for night_dir in sorted(session.iterdir()):
            if not night_dir.is_dir() or not NIGHT_DIR_RE.match(night_dir.name):
                continue
            light_root = night_dir / "LIGHT"
            if not light_root.is_dir():
                continue
            for filt_dir in sorted(light_root.iterdir()):
                if not filt_dir.is_dir():
                    continue
                filt = normalize_filter(filt_dir.name)
                frame_files = iter_frame_files(filt_dir)
                session_light_files += len(frame_files)
                counts: dict[float, int] = defaultdict(int)
                for key, _name, exposure, _night, _stamp in unique_capture_files(
                    frame_files, filt
                ):
                    session_index[key] = (night_dir.name, filt, exposure)
                    counts[exposure] += 1
                for exposure, total in counts.items():
                    calibration_groups.append(
                        Group(filt, exposure, total, total, night_dir.name)
                    )
    else:
        warnings.append(
            "No .SessionData directory was found; acquired lights could not be counted."
        )

    if not calibration_groups:
        if session_light_files:
            warnings.append(
                "SessionData LIGHT files were found but did not match the expected "
                "filename pattern; acquired counts may be missing."
            )
        else:
            warnings.append("No LIGHT frames were found under .SessionData.")

    stages = [
        (number, path)
        for number, path in pipeline_dirs(root)
        if 1 <= number <= MAX_PER_FRAME_STEP
    ]
    empty_stages = [
        path.name
        for number, path in stages
        if not iter_frame_files(path)
    ]
    if empty_stages:
        warnings.append(
            "Empty pipeline stages were skipped: " + ", ".join(empty_stages) + "."
        )

    filters = {group.filter_name for group in calibration_groups}
    for _number, stage in stages:
        for child in stage.iterdir():
            if child.is_dir() and child.name.casefold() not in IGNORE_WALK_DIRS:
                filters.add(normalize_filter(child.name))

    kept_by_night: Counter[tuple[str, str]] = Counter()
    kept_totals: dict[tuple[str, float], int] = defaultdict(int)
    stage_used: list[str] = []

    for filt in sorted(filters, key=lambda name: filter_sort_key((name, 0))):
        chosen: list[Path] = []
        chosen_stage = ""
        for _number, stage in reversed(stages):
            folder = filter_subdir(stage, filt)
            if folder is None:
                continue
            files = iter_frame_files(folder)
            if files:
                chosen = files
                chosen_stage = stage.name
                break
        if chosen_stage:
            stage_used.append(f"{filt} from {chosen_stage}")
        unmatched = 0
        for key, name, exposure, parent_night, stamp_date in unique_capture_files(
            chosen, filt
        ):
            if key in session_index:
                night, name, exposure = session_index[key]
            else:
                night = parent_night or stamp_date
                unmatched += 1
            if not night:
                warnings.append(
                    f"Could not map a kept {name} frame to a session night: {key}."
                )
                continue
            kept_by_night[(night, name)] += 1
            kept_totals[(name, exposure)] += 1
        if unmatched:
            warnings.append(
                f"{unmatched} kept {filt} frame(s) were not found in .SessionData; "
                "night dates fell back to the filename timestamp."
            )

    if stage_used:
        warnings.append("Kept frames counted per filter: " + "; ".join(stage_used) + ".")

    acquired_totals: dict[tuple[str, float], int] = defaultdict(int)
    for group in calibration_groups:
        acquired_totals[(group.filter_name, group.exposure)] += group.total

    integration_groups = [
        Group(name, exposure, acquired_totals.get((name, exposure), kept), kept)
        for (name, exposure), kept in kept_totals.items()
    ]
    for key, total in acquired_totals.items():
        if key not in kept_totals:
            integration_groups.append(Group(key[0], key[1], total, 0))

    expected_kept = sum(group.active for group in integration_groups)
    mapped_kept = sum(kept_by_night.values())
    if mapped_kept and mapped_kept != expected_kept:
        warnings.append(
            f"Mapped {mapped_kept} of {expected_kept} kept frames to session nights; "
            "night rows are incomplete."
        )

    return ParseResult(
        wbpp_version=None,
        calibration_groups=calibration_groups,
        integration_groups=integration_groups,
        kept_by_night=kept_by_night,
        center_ra=None,
        center_dec=None,
        center_ra_deg=None,
        center_dec_deg=None,
        pixel_size_um=None,
        arcsec_per_px=None,
        warnings=warnings,
    )


GENERIC_TARGET_HINTS = {
    "stars",
    "star",
    "rgb",
    "lrgb",
    "mosaic",
    "panel",
    "narrowband",
    "nb",
    "ha",
    "h",
    "oiii",
    "o",
    "sii",
    "s",
    "l",
    "r",
    "g",
    "b",
    "logs",
    "wbpp",
    "light",
    "flat",
    "blinked",
    "calibrated",
    "corrected",
    "weighted",
    "registered",
    "localnormalized",
    "integrated",
    "sessiondata",
    "referenceframe",
    "finished",
    "calibration",
}


def is_drive_part(part: str) -> bool:
    return bool(re.match(r"^[A-Za-z]:\\?$", part))


def is_generic_target_hint(hint: str) -> bool:
    text = hint.strip()
    compact = re.sub(r"[^a-z0-9]+", "", text.casefold())
    if compact in GENERIC_TARGET_HINTS:
        return True
    if YEAR_DIR_RE.match(text) or NIGHT_DIR_RE.match(text):
        return True
    if PIPELINE_DIR_RE.match(text):
        return True
    return bool(re.match(r"(?i)^(panel|mosaic)[-_ ]?\d*$", text))


def target_hint_from_path(log_path: str) -> str:
    windows = PureWindowsPath(log_path.replace("/", "\\"))
    parts = list(windows.parts)
    if windows.suffix:
        parts = parts[:-1]
    for part in reversed(parts):
        if is_drive_part(part) or is_generic_target_hint(part):
            continue
        return part
    return windows.parent.name if windows.suffix else windows.name


def prefer_target_hint(hints: Iterable[str], override: str = "") -> str:
    if override.strip():
        return override.strip()
    ordered = list(dict.fromkeys(item.strip() for item in hints if item and item.strip()))
    specific = [item for item in ordered if not is_generic_target_hint(item)]
    if specific:
        return specific[0]
    return ordered[0] if ordered else ""


def merge_parse_results(results: list[tuple[str, ParseResult]]) -> ParseResult:
    if not results:
        raise ValueError("At least one WBPP parse result is required.")
    if len(results) == 1:
        return results[0][1]

    calibration_groups: list[Group] = []
    integration_totals: dict[tuple[str, float], list[int]] = defaultdict(lambda: [0, 0])
    kept_by_night: Counter[tuple[str, str]] = Counter()
    warnings: list[str] = []
    versions: list[str] = []
    center_ra = center_dec = None
    center_ra_deg = center_dec_deg = pixel_size_um = arcsec_per_px = None

    for label, parsed in results:
        calibration_groups.extend(parsed.calibration_groups)
        for key, group in best_integration_groups(parsed.integration_groups).items():
            integration_totals[key][0] += group.total
            integration_totals[key][1] += group.active
        kept_by_night.update(parsed.kept_by_night)
        for warning in parsed.warnings:
            warnings.append(f"{label}: {warning}" if label else warning)
        if parsed.wbpp_version:
            versions.append(parsed.wbpp_version)

        if parsed.center_ra_deg is not None and parsed.center_dec_deg is not None:
            if center_ra_deg is None or center_dec_deg is None:
                center_ra = parsed.center_ra
                center_dec = parsed.center_dec
                center_ra_deg = parsed.center_ra_deg
                center_dec_deg = parsed.center_dec_deg
            else:
                delta = angular_separation_deg(
                    center_ra_deg,
                    center_dec_deg,
                    parsed.center_ra_deg,
                    parsed.center_dec_deg,
                )
                if delta > 0.5:
                    warnings.append(
                        f"{label}: WBPP image center differs by {delta:.1f}° from the first "
                        "solved log (mosaic?); using the first solved center."
                    )

        if parsed.pixel_size_um is not None:
            if pixel_size_um is None:
                pixel_size_um = parsed.pixel_size_um
            elif abs(parsed.pixel_size_um - pixel_size_um) > 0.05:
                warnings.append(
                    f"{label}: pixel size {parsed.pixel_size_um:g} µm differs from "
                    f"{pixel_size_um:g} µm in an earlier log."
                )
        if parsed.arcsec_per_px is not None:
            if arcsec_per_px is None:
                arcsec_per_px = parsed.arcsec_per_px
            elif abs(parsed.arcsec_per_px - arcsec_per_px) > 0.05:
                warnings.append(
                    f"{label}: image scale {parsed.arcsec_per_px:g} as/px differs from "
                    f"{arcsec_per_px:g} as/px in an earlier log."
                )

    unique_versions = list(dict.fromkeys(versions))
    if len(unique_versions) > 1:
        warnings.append(f"WBPP versions differ across logs: {', '.join(unique_versions)}.")

    integration_groups = [
        Group(name, exposure, total, active)
        for (name, exposure), (total, active) in integration_totals.items()
    ]
    expected_kept = sum(active for _, active in integration_totals.values())
    mapped_kept = sum(kept_by_night.values())
    if mapped_kept and mapped_kept != expected_kept:
        warnings.append(
            f"Mapped {mapped_kept} of {expected_kept} integrated frames to NIGHT sessions "
            "after merging logs; night rows are incomplete."
        )

    return ParseResult(
        wbpp_version=unique_versions[0] if unique_versions else None,
        calibration_groups=calibration_groups,
        integration_groups=integration_groups,
        kept_by_night=kept_by_night,
        center_ra=center_ra,
        center_dec=center_dec,
        center_ra_deg=center_ra_deg,
        center_dec_deg=center_dec_deg,
        pixel_size_um=pixel_size_um,
        arcsec_per_px=arcsec_per_px,
        warnings=warnings,
    )


def target_candidates(hint: str) -> list[str]:
    candidates = re.findall(r"\(([^()]+)\)", hint)
    candidates += [re.sub(r"\s*\([^()]+\)\s*", " ", hint).strip(), hint.strip()]
    result: list[str] = []
    for candidate in candidates:
        if candidate and candidate not in result:
            result.append(candidate)
    return result


def load_env_file(path: Path) -> None:
    if not path.is_file():
        return
    for raw in path.read_text(encoding="utf-8").splitlines():
        line = raw.strip()
        if not line or line.startswith("#") or "=" not in line:
            continue
        if line.startswith("export "):
            line = line[7:].strip()
        key, _, value = line.partition("=")
        key = key.strip()
        value = value.strip()
        if len(value) >= 2 and value[0] == value[-1] and value[0] in {"'", '"'}:
            value = value[1:-1]
        if key and key not in os.environ:
            os.environ[key] = value


def load_project_env() -> None:
    root = Path(__file__).resolve().parent.parent
    for name in (".env", ".env.local"):
        load_env_file(root / name)


def resolve_ollama_model(host: str, timeout: float) -> str:
    explicit = os.environ.get("OLLAMA_MODEL", "").strip()
    if explicit:
        return explicit
    try:
        payload = http_json(host.rstrip("/") + "/api/tags", {}, timeout)
    except (OSError, ValueError, KeyError, urllib.error.URLError):
        return ""
    names = [
        str(item.get("name") or "").strip()
        for item in payload.get("models", [])
        if isinstance(item, dict)
    ]
    names = [name for name in names if name]
    if not names:
        return ""
    by_name = {name.casefold(): name for name in names}
    for preferred in PREFERRED_OLLAMA_MODELS:
        if preferred.casefold() in by_name:
            return by_name[preferred.casefold()]
    preferred_stems = [item.split(":", 1)[0].casefold() for item in PREFERRED_OLLAMA_MODELS]
    for name in names:
        if name.split(":", 1)[0].casefold() in preferred_stems:
            return name
    return names[0]


def slugify(value: str) -> str:
    value = value.casefold().encode("ascii", "ignore").decode("ascii")
    return re.sub(r"(^-+|-+$)", "", re.sub(r"[^a-z0-9]+", "-", value))[:80]


def frame_slug(catalog_id: str, revision: str = "") -> str:
    base = slugify(catalog_id)
    rev = slugify(revision)
    if not base or not rev:
        return base
    return f"{base}-{rev}"[:80]


def adql_quote(value: str) -> str:
    return value.replace("'", "''")


def tap_query(endpoint: str, query: str, timeout: float) -> dict[str, Any]:
    body = urllib.parse.urlencode(
        {"REQUEST": "doQuery", "LANG": "ADQL", "FORMAT": "json", "QUERY": query}
    ).encode("utf-8")
    request = urllib.request.Request(
        endpoint,
        data=body,
        headers={
            "Content-Type": "application/x-www-form-urlencoded",
            "User-Agent": HTTP_USER_AGENT,
        },
    )
    with urllib.request.urlopen(request, timeout=timeout) as response:
        return json.load(response)


def tap_rows(payload: dict[str, Any]) -> list[dict[str, Any]]:
    columns = [
        column.get("name", column) if isinstance(column, dict) else column
        for column in payload.get("metadata", [])
    ]
    return [dict(zip(columns, row)) for row in payload.get("data", [])]


def http_json(endpoint: str, params: dict[str, str], timeout: float) -> dict[str, Any]:
    separator = "&" if "?" in endpoint else "?"
    url = endpoint + separator + urllib.parse.urlencode(params)
    request = urllib.request.Request(url, headers={"User-Agent": HTTP_USER_AGENT})
    with urllib.request.urlopen(request, timeout=timeout) as response:
        return json.load(response)


def normalized_identifier(value: str) -> str:
    return re.sub(r"[^a-z0-9]+", "", value.casefold())


def looks_like_catalog_id(value: str) -> bool:
    compact = re.sub(r"\s+", " ", value).strip()
    if not compact:
        return True
    if re.search(
        r"\b(nebula|galaxy|cluster|cloud|remnant|bubble|veil|horsehead|pillar)\b",
        compact,
        re.I,
    ):
        return False
    return bool(CATALOG_ID_RE.match(compact))


def clean_wiki_phrase(value: str) -> str:
    value = re.sub(r"\[\[(?:[^|\]]+\|)?([^\]]+)\]\]", r"\1", value)
    value = re.sub(r"'{2,}", "", value)
    value = re.sub(r"<[^>]+>", "", value)
    return re.sub(r"\s+", " ", value).strip(" \t.,;:")


def common_name_from_aliases(aliases: Iterable[str]) -> str:
    for alias in aliases:
        stripped = str(alias or "").strip()
        if stripped.upper().startswith("NAME "):
            name = stripped[5:].strip()
            if name and not looks_like_catalog_id(name):
                return name
    return ""


def common_name_from_hint(hint: str, catalog_id: str) -> str:
    catalog_key = normalized_identifier(catalog_id)
    for item in re.findall(r"\(([^()]+)\)", hint):
        name = item.strip()
        if (
            name
            and not looks_like_catalog_id(name)
            and normalized_identifier(name) != catalog_key
        ):
            return name
    stripped = re.sub(r"\s*\([^()]+\)\s*", " ", hint).strip()
    if (
        stripped
        and not looks_like_catalog_id(stripped)
        and normalized_identifier(stripped) != catalog_key
    ):
        return stripped
    return ""


def _claim_text(entity: dict[str, Any], prop: str) -> str | None:
    try:
        value = entity["claims"][prop][0]["mainsnak"]["datavalue"]["value"]
        if isinstance(value, dict):
            text = str(value.get("text") or "").strip()
            return text or None
        text = str(value).strip()
        return text or None
    except (KeyError, IndexError, TypeError, ValueError):
        return None


def _claim_entity_id(entity: dict[str, Any], prop: str) -> str | None:
    try:
        return str(entity["claims"][prop][0]["mainsnak"]["datavalue"]["value"]["id"])
    except (KeyError, IndexError, TypeError):
        return None


def _claim_quantity(entity: dict[str, Any], prop: str) -> float | None:
    try:
        amount = entity["claims"][prop][0]["mainsnak"]["datavalue"]["value"]["amount"]
        return float(amount)
    except (KeyError, IndexError, TypeError, ValueError):
        return None


def _claim_quantity_unit(entity: dict[str, Any], prop: str) -> tuple[float | None, str | None]:
    try:
        value = entity["claims"][prop][0]["mainsnak"]["datavalue"]["value"]
        amount = float(value["amount"])
        unit = str(value.get("unit") or "")
        qid = unit.rsplit("/", 1)[-1] if unit.startswith("http") else (unit or None)
        return amount, qid
    except (KeyError, IndexError, TypeError, ValueError):
        return None, None


def to_light_years(value: float, unit: str | None) -> float | None:
    compact = re.sub(r"[^a-z]+", "", (unit or "").casefold())
    if compact in {"pc", "parsec", "parsecs"}:
        return value * PC_TO_LY
    if compact in {"kpc", "kiloparsec", "kiloparsecs"}:
        return value * PC_TO_LY * 1_000
    if compact in {"mpc", "megaparsec", "megaparsecs"}:
        return value * PC_TO_LY * 1_000_000
    if compact in {"ly", "lyr", "lightyear", "lightyears"}:
        return value
    return None


def format_light_years(value: float, approximate: bool = False) -> str:
    rounded = int(round(value))
    prefix = "≈ " if approximate else ""
    return f"{prefix}{rounded:,} ly"


def resolve_wikidata_constellation(
    hint: str,
    simbad: dict[str, Any],
    endpoint: str = DEFAULT_WIKIDATA_URL,
    timeout: float = 20.0,
) -> tuple[dict[str, str], list[str]]:
    queries = [
        str(simbad.get("matched_query") or "").strip(),
        *target_candidates(hint),
        str(simbad.get("main_id") or "").strip(),
    ]
    match: dict[str, Any] | None = None
    for query in dict.fromkeys(item for item in queries if item):
        payload = http_json(
            endpoint,
            {
                "action": "wbsearchentities",
                "search": query,
                "language": "en",
                "format": "json",
                "limit": "5",
            },
            timeout,
        )
        wanted = normalized_identifier(query)
        for candidate in payload.get("search", []):
            names = [candidate.get("label", ""), *candidate.get("aliases", [])]
            if wanted in {normalized_identifier(str(name)) for name in names}:
                match = candidate
                break
        if match:
            break

    if not match:
        return {}, [f"Wikidata did not resolve target hint: {hint}"]

    entity_id = str(match["id"])
    entity_payload = http_json(
        endpoint,
        {
            "action": "wbgetentities",
            "ids": entity_id,
            "props": "claims|labels|aliases|sitelinks",
            "languages": "en",
            "format": "json",
        },
        timeout,
    )
    entity = entity_payload.get("entities", {}).get(entity_id, {})

    # Guard against an unrelated same-name search result by comparing it with
    # the independently resolved SIMBAD coordinates when both are available.
    entity_ra = _claim_quantity(entity, "P6257")
    entity_dec = _claim_quantity(entity, "P6258")
    if (
        entity_ra is not None
        and entity_dec is not None
        and simbad.get("ra") is not None
        and simbad.get("dec") is not None
    ):
        ra_delta = abs(entity_ra - float(simbad["ra"])) % 360
        ra_delta = min(ra_delta, 360 - ra_delta)
        dec_delta = abs(entity_dec - float(simbad["dec"]))
        if ra_delta > 5 or dec_delta > 5:
            return {}, [
                f"Wikidata result {entity_id} disagrees with SIMBAD coordinates; "
                "constellation was omitted."
            ]

    result: dict[str, str] = {"wikidataId": entity_id}
    wikipedia_title = (
        entity.get("sitelinks", {}).get("enwiki", {}).get("title") or ""
    ).strip()
    if wikipedia_title:
        result["wikipediaTitle"] = wikipedia_title
    amount, unit_qid = _claim_quantity_unit(entity, "P2583")
    if amount is not None:
        ly = to_light_years(amount, WIKIDATA_DISTANCE_UNITS.get(unit_qid or "", unit_qid))
        if ly is not None:
            result["distanceLy"] = format_light_years(ly)

    names = []
    claimed = _claim_text(entity, "P2561")
    if claimed:
        names.append(claimed)
    names.extend(
        str(item.get("value") or "").strip()
        for item in entity.get("aliases", {}).get("en", [])
        if isinstance(item, dict)
    )
    label = str(entity.get("labels", {}).get("en", {}).get("value") or "").strip()
    if label:
        names.append(label)
    for name in names:
        if name and not looks_like_catalog_id(name):
            result["commonName"] = name
            break

    constellation_id = _claim_entity_id(entity, "P59")
    if not constellation_id:
        return result, [f"Wikidata target {entity_id} has no constellation claim."]

    constellation_payload = http_json(
        endpoint,
        {
            "action": "wbgetentities",
            "ids": constellation_id,
            "props": "labels",
            "languages": "en",
            "format": "json",
        },
        timeout,
    )
    constellation_entity = constellation_payload.get("entities", {}).get(
        constellation_id, {}
    )
    constellation = constellation_entity.get("labels", {}).get("en", {}).get("value", "")
    warnings = []
    if not constellation:
        warnings.append(f"Wikidata constellation {constellation_id} has no English label.")
    result["constellation"] = str(constellation)
    return result, warnings


def resolve_simbad(
    hint: str,
    endpoint: str = DEFAULT_SIMBAD_URL,
    timeout: float = 20.0,
) -> tuple[dict[str, Any], list[str]]:
    warnings: list[str] = []
    selected: dict[str, Any] | None = None

    for candidate in target_candidates(hint):
        query = (
            "SELECT TOP 1 b.oid, b.main_id, b.ra, b.dec, b.otype, "
            "b.sp_type, b.plx_value FROM basic AS b "
            "JOIN ident AS i ON b.oid = i.oidref "
            f"WHERE i.id = '{adql_quote(candidate)}'"
        )
        rows = tap_rows(tap_query(endpoint, query, timeout))
        if rows:
            selected = rows[0]
            selected["matched_query"] = candidate
            break

    if not selected:
        return {}, [f"SIMBAD did not resolve target hint: {hint}"]

    oid = int(selected["oid"])
    alias_query = f"SELECT id FROM ident WHERE oidref = {oid} ORDER BY id"
    selected["aliases"] = [
        row["id"] for row in tap_rows(tap_query(endpoint, alias_query, timeout)) if row.get("id")
    ]
    common_name = common_name_from_aliases(selected["aliases"])
    if common_name:
        selected["commonName"] = common_name

    try:
        distance_query = (
            "SELECT TOP 5 dist, unit, minus_err, plus_err, bibcode "
            f"FROM mesDistance WHERE oidref = {oid}"
        )
        distances = tap_rows(tap_query(endpoint, distance_query, timeout))
        for item in distances:
            try:
                if to_light_years(float(item["dist"]), str(item.get("unit") or "")) is not None:
                    selected["distance"] = item
                    break
            except (TypeError, ValueError, KeyError):
                continue
    except (OSError, ValueError, KeyError, urllib.error.URLError) as exc:
        warnings.append(f"SIMBAD distance lookup failed: {exc}")

    return selected, warnings


OLLAMA_SCHEMA: dict[str, Any] = {
    "type": "object",
    "properties": {
        "bodyMarkdown": {"type": "string", "minLength": 240},
    },
    "required": ["bodyMarkdown"],
}
MIN_BODY_SENTENCES = 3


def sentence_count(text: str) -> int:
    pieces = re.findall(r"[^.!?]+[.!?]+", text.strip())
    return len([piece for piece in pieces if re.search(r"[A-Za-z]", piece)])


def ollama_chat(
    model: str,
    host: str,
    timeout: float,
    messages: list[dict[str, str]],
) -> dict[str, str]:
    payload = {
        "model": model,
        "stream": False,
        "format": OLLAMA_SCHEMA,
        "messages": messages,
        "options": {"temperature": 0.7, "num_predict": 400},
    }
    request = urllib.request.Request(
        host.rstrip("/") + "/api/chat",
        data=json.dumps(payload).encode("utf-8"),
        headers={"Content-Type": "application/json"},
    )
    with urllib.request.urlopen(request, timeout=timeout) as response:
        result = json.load(response)
    content = result.get("message", {}).get("content", "")
    parsed = json.loads(content)
    return {key: str(parsed.get(key, "") or "").strip() for key in OLLAMA_SCHEMA["properties"]}


def catalog_facts_for_prose(target_hint: str, simbad: dict[str, Any]) -> dict[str, str]:
    coordinates = ""
    try:
        if simbad.get("ra") is not None and simbad.get("dec") is not None:
            coordinates = (
                f"RA {float(simbad['ra']):.6f}° · Dec {float(simbad['dec']):+.6f}°"
            )
    except (TypeError, ValueError):
        pass
    return {
        "targetHint": target_hint,
        "catalogId": str(
            simbad.get("matched_query") or simbad.get("main_id") or ""
        ).strip(),
        "commonName": str(simbad.get("commonName") or "").strip(),
        "objectClass": humanize_otype(str(simbad.get("otype") or "")),
        "spectralType": str(simbad.get("sp_type") or "").strip(),
        "constellation": str(simbad.get("constellation") or "").strip(),
        "distance": format_distance(simbad),
        "coordinates": coordinates,
    }


def enrich_with_ollama(
    target_hint: str,
    simbad: dict[str, Any],
    model: str,
    host: str,
    timeout: float,
) -> dict[str, str]:
    facts = catalog_facts_for_prose(target_hint, simbad)
    prompt = (
        "Write exactly four complete sentences about this deep-sky target for the Body "
        "field of an astrophotography log. Never write fewer than three sentences. Each "
        "sentence must end with a period. Cover, in order: (1) the common name or catalog "
        "ID and a visual impression of the object; (2) what kind of object it is; (3) the "
        "constellation and its place on the sky; (4) the distance if one is given, otherwise "
        "a quiet closing image drawn only from the given facts. The tone is spare, specific, "
        "and a little lyrical — quiet rather than purple, never a sales pitch. Use only the "
        "supplied catalog facts. Do not invent distances, classifications, catalog IDs, "
        "discoveries, physical mechanisms, or observing history. Do not mention cameras, "
        "telescopes, filters, integration time, processing, or the photographer. Return one "
        "paragraph of four sentences with no headings, lists, or wrapping quotation marks.\n\n"
        "Facts:\n"
        + json.dumps(facts, ensure_ascii=False)
    )
    messages = [
        {
            "role": "system",
            "content": (
                "You write spare lyrical captions for deep-sky photographs, "
                "always in three or four complete sentences, grounded only in "
                "verified catalog facts."
            ),
        },
        {"role": "user", "content": prompt},
    ]
    parsed = ollama_chat(model, host, timeout, messages)
    if sentence_count(parsed.get("bodyMarkdown", "")) >= MIN_BODY_SENTENCES:
        return parsed

    messages.append({"role": "assistant", "content": json.dumps(parsed, ensure_ascii=False)})
    messages.append(
        {
            "role": "user",
            "content": (
                f"Too short: that was {sentence_count(parsed.get('bodyMarkdown', ''))} "
                "sentence(s). Rewrite bodyMarkdown as exactly four complete sentences, "
                "each ending with a period. Keep the same tone and do not add facts."
            ),
        }
    )
    return ollama_chat(model, host, timeout, messages)


def format_sessions(nights: list[str]) -> str:
    if not nights:
        return ""
    first = date.fromisoformat(nights[0])
    last = date.fromisoformat(nights[-1])
    if first == last:
        span = f"{first.day:02d} {MONTHS[first.month - 1]} {first.year}"
    elif first.year == last.year:
        span = (
            f"{first.day:02d} {MONTHS[first.month - 1]} – "
            f"{last.day:02d} {MONTHS[last.month - 1]} {last.year}"
        )
    else:
        span = (
            f"{first.day:02d} {MONTHS[first.month - 1]} {first.year} – "
            f"{last.day:02d} {MONTHS[last.month - 1]} {last.year}"
        )
    return f"{len(nights)} night{'s' if len(nights) != 1 else ''} · {span}"


def format_coordinates(simbad: dict[str, Any], parsed: ParseResult) -> str:
    if simbad.get("ra") is not None and simbad.get("dec") is not None:
        return f"RA {float(simbad['ra']):.6f}° · Dec {float(simbad['dec']):+.6f}°"
    if parsed.center_ra and parsed.center_dec:
        return f"RA {parsed.center_ra} · Dec {parsed.center_dec}"
    if parsed.center_ra_deg is not None and parsed.center_dec_deg is not None:
        return f"RA {parsed.center_ra_deg:.6f}° · Dec {parsed.center_dec_deg:+.6f}°"
    return ""


def format_distance(simbad: dict[str, Any]) -> str:
    item = simbad.get("distance") or {}
    try:
        ly = to_light_years(float(item["dist"]), str(item.get("unit") or ""))
        if ly is not None:
            return format_light_years(ly)
    except (TypeError, ValueError, KeyError):
        pass
    catalog = str(simbad.get("distanceLy") or "").strip()
    if catalog:
        return catalog
    try:
        parallax = float(simbad.get("plx_value"))
        if parallax > 0:
            return format_light_years((1000 / parallax) * PC_TO_LY, approximate=True)
    except (TypeError, ValueError):
        pass
    return ""


def wikipedia_title_candidates(simbad: dict[str, Any], hint: str) -> list[str]:
    titles: list[str] = []
    aliases = [str(item) for item in simbad.get("aliases") or [] if item]
    for item in (
        str(simbad.get("wikipediaTitle") or "").strip(),
        *target_candidates(hint),
        str(simbad.get("matched_query") or "").strip(),
        str(simbad.get("main_id") or "").strip(),
        *aliases,
    ):
        compact = re.sub(r"\s+", " ", str(item or "")).strip()
        if not compact:
            continue
        titles.append(compact)
        match = re.match(r"(?i)^sh\s*2\s*-?\s*(\d+)$", compact)
        if match:
            titles.append(f"Sh 2-{match.group(1)}")
    return list(dict.fromkeys(titles))


def parse_wikipedia_distance(wikitext: str) -> str:
    fields: dict[str, str] = {}
    for match in INFOBOX_DISTANCE_RE.finditer(wikitext):
        key = match.group(1).casefold()
        value = re.sub(r"<!--.*?-->", "", match.group(2), flags=re.S).strip()
        if not value or value.startswith("|"):
            continue
        if key not in fields:
            fields[key] = value

    field_units = {"dist_ly": "ly", "dist_pc": "pc", "dist_kpc": "kpc"}
    for key in ("dist_ly", "dist_pc", "dist_kpc", "distance"):
        raw = fields.get(key, "")
        if not raw:
            continue
        convert = CONVERT_TEMPLATE_RE.search(raw)
        unit: str | None
        if convert:
            amount = float(convert.group(1).replace(",", ""))
            unit = convert.group(2)
        else:
            number = re.search(r"([0-9][0-9,]*(?:\.[0-9]+)?)", raw)
            if not number:
                continue
            amount = float(number.group(1).replace(",", ""))
            unit = field_units.get(key)
            if unit is None:
                unit_match = re.search(r"(kpc|mpc|pc|ly|light[\s-]*years?)", raw, re.I)
                unit = unit_match.group(1) if unit_match else None
        ly = to_light_years(amount, unit)
        if ly is None:
            continue
        approximate = raw.lstrip().startswith("~") or "approx" in raw.casefold()
        return format_light_years(ly, approximate=approximate)
    return ""


def parse_wikipedia_common_name(wikitext: str, title: str = "") -> str:
    match = ALSO_KNOWN_AS_RE.search(wikitext)
    if match:
        name = clean_wiki_phrase(match.group(1))
        if name and not looks_like_catalog_id(name):
            return name
    cleaned_title = clean_wiki_phrase(title)
    if cleaned_title and not looks_like_catalog_id(cleaned_title):
        return cleaned_title
    return ""


def resolve_wikipedia(
    simbad: dict[str, Any],
    hint: str,
    endpoint: str = DEFAULT_WIKIPEDIA_URL,
    timeout: float = 20.0,
) -> tuple[dict[str, str], list[str]]:
    for title in wikipedia_title_candidates(simbad, hint):
        payload = http_json(
            endpoint,
            {
                "action": "parse",
                "page": title,
                "prop": "wikitext",
                "format": "json",
                "formatversion": "2",
                "redirects": "1",
            },
            timeout,
        )
        if payload.get("error"):
            continue
        wikitext = payload.get("parse", {}).get("wikitext") or ""
        if isinstance(wikitext, dict):
            wikitext = str(wikitext.get("*") or "")
        resolved = str(payload.get("parse", {}).get("title") or title)
        distance = parse_wikipedia_distance(str(wikitext))
        common_name = parse_wikipedia_common_name(str(wikitext), resolved)
        if not distance and not common_name:
            continue
        result = {"wikipediaTitle": resolved}
        if distance:
            result["distanceLy"] = distance
            result["distanceSource"] = "Wikipedia"
        if common_name:
            result["commonName"] = common_name
            result["nameSource"] = "Wikipedia"
        return result, []
    return {}, []


def humanize_otype(value: str) -> str:
    known = {
        "WR*": "Wolf-Rayet star",
        "V*": "Variable star",
        "Em*": "Emission-line star",
        "HII": "H II region",
        "PN": "Planetary nebula",
        "SNR": "Supernova remnant",
        "RfN": "Reflection nebula",
        "EmObj": "Emission object",
        "G": "Galaxy",
        "GiC": "Galaxy in cluster",
        "AGN": "Active galactic nucleus",
        "QSO": "Quasar",
        "Cl*": "Star cluster",
        "OpC": "Open cluster",
        "GlC": "Globular cluster",
    }
    return known.get(value, value)


def constellation_from_aliases(aliases: Iterable[str]) -> str:
    # Variable-star aliases commonly end in an official IAU abbreviation.
    known = {
        "And": "Andromeda", "Ant": "Antlia", "Aps": "Apus", "Aqr": "Aquarius",
        "Aql": "Aquila", "Ara": "Ara", "Ari": "Aries", "Aur": "Auriga",
        "Boo": "Boötes", "Cae": "Caelum", "Cam": "Camelopardalis", "Cnc": "Cancer",
        "CVn": "Canes Venatici", "CMa": "Canis Major", "CMi": "Canis Minor",
        "Cap": "Capricornus", "Car": "Carina", "Cas": "Cassiopeia", "Cen": "Centaurus",
        "Cep": "Cepheus", "Cet": "Cetus", "Cha": "Chamaeleon", "Cir": "Circinus",
        "Col": "Columba", "Com": "Coma Berenices", "CrA": "Corona Australis",
        "CrB": "Corona Borealis", "Crv": "Corvus", "Crt": "Crater", "Cru": "Crux",
        "Cyg": "Cygnus", "Del": "Delphinus", "Dor": "Dorado", "Dra": "Draco",
        "Equ": "Equuleus", "Eri": "Eridanus", "For": "Fornax", "Gem": "Gemini",
        "Gru": "Grus", "Her": "Hercules", "Hor": "Horologium", "Hya": "Hydra",
        "Hyi": "Hydrus", "Ind": "Indus", "Lac": "Lacerta", "Leo": "Leo",
        "LMi": "Leo Minor", "Lep": "Lepus", "Lib": "Libra", "Lup": "Lupus",
        "Lyn": "Lynx", "Lyr": "Lyra", "Men": "Mensa", "Mic": "Microscopium",
        "Mon": "Monoceros", "Mus": "Musca", "Nor": "Norma", "Oct": "Octans",
        "Oph": "Ophiuchus", "Ori": "Orion", "Pav": "Pavo", "Peg": "Pegasus",
        "Per": "Perseus", "Phe": "Phoenix", "Pic": "Pictor", "Psc": "Pisces",
        "PsA": "Piscis Austrinus", "Pup": "Puppis", "Pyx": "Pyxis", "Ret": "Reticulum",
        "Sge": "Sagitta", "Sgr": "Sagittarius", "Sco": "Scorpius", "Scl": "Sculptor",
        "Sct": "Scutum", "Ser": "Serpens", "Sex": "Sextans", "Tau": "Taurus",
        "Tel": "Telescopium", "Tri": "Triangulum", "TrA": "Triangulum Australe",
        "Tuc": "Tucana", "UMa": "Ursa Major", "UMi": "Ursa Minor", "Vel": "Vela",
        "Vir": "Virgo", "Vol": "Volans", "Vul": "Vulpecula",
    }
    for alias in aliases:
        match = re.search(r"\b([A-Z][A-Za-z]{2})$", alias.strip())
        if match and match.group(1) in known:
            return known[match.group(1)]
    return ""


def truncate(value: str, limit: int) -> str:
    return value if len(value) <= limit else value[: limit - 1].rstrip() + "…"


def preferred_catalog_ids(simbad: dict[str, Any]) -> list[str]:
    aliases = [str(item) for item in simbad.get("aliases", [])]
    preferred = [
        str(simbad.get("matched_query") or "").strip(),
        str(simbad.get("main_id") or "").strip(),
    ]
    prefixes = (
        "M ",
        "NGC ",
        "IC ",
        "Sh2-",
        "LBN ",
        "LDN ",
        "WR ",
        "V* ",
        "HD ",
        "HIP ",
        "PGC ",
        "UGC ",
        "Gaia DR3 ",
    )
    preferred.extend(alias for alias in aliases if alias.startswith(prefixes))
    return list(dict.fromkeys(item for item in preferred if item))


def build_draft(
    log_path: Path | str | Iterable[Path | str],
    parsed: ParseResult,
    target_hint: str,
    simbad: dict[str, Any],
    enrichment: dict[str, str],
    *,
    bandwidth: str,
    optics: str,
    sensor: str,
    sky: str,
    frame_number: str,
    revision: str,
) -> dict[str, Any]:
    log_paths = as_log_paths(log_path)
    log_files = [path for path in log_paths if source_kind(path) == "log"]
    processing_dirs = [path for path in log_paths if source_kind(path) == "dir"]
    acquisition_parts: list[str] = []
    if log_files:
        acquisition_parts.append(
            "WBPP light calibration and final ImageIntegration groups"
        )
    if processing_dirs:
        acquisition_parts.append(
            "manual processing directory (.SessionData lights and last populated pipeline stage)"
        )
    acquired: dict[tuple[str, float], int] = defaultdict(int)
    acquired_nights: dict[tuple[str, str, float], int] = defaultdict(int)
    for group in parsed.calibration_groups:
        if not group.night:
            continue
        acquired[(group.filter_name, group.exposure)] += group.total
        acquired_nights[(group.night, group.filter_name, group.exposure)] += group.total

    integrated_groups = best_integration_groups(parsed.integration_groups)
    integrated = {key: group.active for key, group in integrated_groups.items()}

    filters: list[dict[str, Any]] = []
    total_seconds = 0.0
    filter_keys = set(acquired) | set(integrated)
    for key in sorted(filter_keys, key=filter_sort_key):
        name, exposure = key
        kept = integrated.get(key, 0)
        total = max(acquired.get(key, 0), kept)
        integration_minutes = int(round(kept * exposure / 60))
        total_seconds += kept * exposure
        filters.append(
            {
                "name": display_filter(name, bandwidth),
                "subLengthSeconds": round(exposure),
                "keptFrames": kept,
                "totalFrames": total,
                "integrationHours": integration_minutes // 60,
                "integrationMinutes": integration_minutes % 60,
            }
        )

    dates = sorted(
        {key[0] for key in acquired_nights} | {night for night, _filt in parsed.kept_by_night}
    )
    nights: list[dict[str, Any]] = []
    mapped_nights_complete = sum(parsed.kept_by_night.values()) == sum(integrated.values())
    if mapped_nights_complete and acquired_nights:
        for (night, filter_name, exposure), total in sorted(acquired_nights.items()):
            kept = parsed.kept_by_night[(night, filter_name)]
            nights.append(
                {
                    "nightDate": night,
                    "filterLabel": display_filter(filter_name, ""),
                    "subLengthSeconds": round(exposure),
                    "kept": kept,
                    "rejected": max(0, total - kept),
                    "reason": "",
                }
            )
    elif mapped_nights_complete and parsed.kept_by_night:
        exposure_by_filter = {name: exposure for name, exposure in integrated}
        for (night, filter_name), kept in sorted(parsed.kept_by_night.items()):
            exposure = exposure_by_filter.get(filter_name, 0.0)
            nights.append(
                {
                    "nightDate": night,
                    "filterLabel": display_filter(filter_name, ""),
                    "subLengthSeconds": round(exposure),
                    "kept": kept,
                    "rejected": 0,
                    "reason": "",
                }
            )

    aliases = [str(item) for item in simbad.get("aliases", [])]
    main_id = str(simbad.get("main_id") or "").strip()
    matched_id = str(simbad.get("matched_query") or "").strip()
    catalog_id = matched_id or main_id or (target_candidates(target_hint)[0] if target_hint else "")
    catalog_line = " · ".join(preferred_catalog_ids(simbad))
    palette = infer_palette(name for name, _ in filter_keys)
    minutes = int(round(total_seconds / 60))
    simbad_class = humanize_otype(str(simbad.get("otype") or ""))
    object_class = simbad_class or enrichment.get("objectClass", "")
    distance = format_distance(simbad)
    common_name = (
        str(simbad.get("commonName") or "").strip()
        or common_name_from_aliases(aliases)
        or common_name_from_hint(target_hint, catalog_id)
    )

    warning_list = list(parsed.warnings)
    if acquired_nights and not mapped_nights_complete:
        warning_list.append(
            "Per-night kept/rejected counts could not be mapped completely; nights is empty "
            "rather than containing estimated values."
        )
    if not dates:
        warning_list.append("No session dates were found; frame.capturedOn was left empty.")
    if not bandwidth:
        warning_list.append("Filter bandwidth is not present in the WBPP log.")
    if not simbad:
        warning_list.append("Target metadata was not verified by SIMBAD.")
    if not distance:
        warning_list.append("Distance was not found in SIMBAD, Wikidata, or Wikipedia.")

    coordinates = format_coordinates(simbad, parsed)
    integration_text = f"{minutes // 60}h {minutes % 60:02d}m"
    constellation = str(simbad.get("constellation") or "") or constellation_from_aliases(
        aliases
    )
    if not constellation:
        warning_list.append(
            "Constellation could not be verified; Ollama output was deliberately ignored."
        )
    meta_parts = [part for part in (constellation, object_class, integration_text) if part]
    optics_label = optics or DEFAULT_OPTICS_LABEL
    sensor_label = sensor or DEFAULT_SENSOR_LABEL
    sky_label = sky or DEFAULT_SKY_LABEL

    frame = {
        "slug": frame_slug(catalog_id, revision),
        "catalogId": truncate(catalog_id, 120),
        "commonName": truncate(common_name, 120),
        "frameNumber": truncate(frame_number, 20),
        "revision": truncate(revision, 10),
        "capturedOn": dates[-1] if dates else "",
        "palette": truncate(palette, 20),
        "bandwidth": truncate(bandwidth, 20),
        "integrationHours": minutes // 60,
        "integrationMinutes": minutes % 60,
        "metaLine": truncate(" · ".join(meta_parts), 200),
        "blurb": truncate(enrichment.get("blurb", ""), 1000),
        "bodyMarkdown": truncate(enrichment.get("bodyMarkdown", ""), 20_000),
        "note": "",
        "plateCatalog": truncate(catalog_line or catalog_id, 200),
        "plateClass": truncate(object_class, 200),
        "plateConstellation": truncate(constellation, 200),
        "plateDistance": truncate(distance, 200),
        "plateCoordinates": truncate(coordinates, 200),
        "platePalette": truncate(palette, 200),
        "plateSessions": truncate(format_sessions(dates), 200),
        "plateSky": truncate(sky_label, 200),
        "opticsLabel": truncate(optics_label, 120),
        "sensorLabel": truncate(sensor_label, 120),
        "arcsecPerPx": plate_scale_arcsec_per_px(),
        "published": False,
    }

    return {
        "schemaVersion": 2,
        "frame": frame,
        "filters": filters,
        "nights": nights,
        "annotations": [],
        "diagnostics": {
            "warnings": warning_list,
            "targetHint": target_hint,
            "wbppVersion": parsed.wbpp_version,
            "sessionDates": dates,
            "acquiredFrames": sum(acquired.values()),
            "integratedFrames": sum(integrated.values()),
            "keptIntegration": {
                "hours": minutes // 60,
                "minutes": minutes % 60,
            },
            "imageCenter": {
                "raDegrees": parsed.center_ra_deg,
                "decDegrees": parsed.center_dec_deg,
            },
            "allCatalogIdentifiers": aliases,
            "wbppLogs": [str(path) for path in log_files],
            "processingDirs": [str(path) for path in processing_dirs],
        },
        "sources": {
            "wbppLog": str(log_files[0]) if len(log_files) == 1 else [str(path) for path in log_files] or None,
            "wbppLogs": [str(path) for path in log_files],
            "processingDirs": [str(path) for path in processing_dirs],
            "acquisition": " + ".join(acquisition_parts) or None,
            "targetCatalog": " + ".join(
                part
                for part, present in (
                    ("SIMBAD", bool(simbad.get("oid") or simbad.get("main_id"))),
                    ("Wikidata", bool(simbad.get("wikidataId"))),
                    ("Wikipedia", simbad.get("distanceSource") == "Wikipedia"
                    or simbad.get("nameSource") == "Wikipedia"),
                )
                if present
            )
            or None,
            "prose": "Ollama" if enrichment else None,
        },
    }


def parse_args(argv: list[str] | None = None) -> argparse.Namespace:
    parser = argparse.ArgumentParser(
        description="Parse WBPP logs and/or manual processing directories into an AstroBlog JSON draft."
    )
    parser.add_argument(
        "inputs",
        nargs="+",
        type=Path,
        metavar="INPUT",
        help="WBPP log files and/or manual processing directories to merge into a single draft",
    )
    parser.add_argument("-o", "--output", type=Path, help="Output JSON path (default: stdout)")
    parser.add_argument("--target", help="Target name override")
    parser.add_argument("--bandwidth", default="", help="Filter bandwidth, e.g. 3nm")
    parser.add_argument(
        "--optics",
        default=DEFAULT_OPTICS_LABEL,
        help="Optics label for the viewer chip",
    )
    parser.add_argument(
        "--sensor",
        default=DEFAULT_SENSOR_LABEL,
        help="Sensor/pixel label for the viewer chip",
    )
    parser.add_argument("--sky", default=DEFAULT_SKY_LABEL, help="Sky/site label")
    parser.add_argument("--frame-number", default="")
    parser.add_argument("--revision", default="")
    parser.add_argument("--no-simbad", action="store_true", help="Disable online SIMBAD lookup")
    parser.add_argument("--no-ollama", action="store_true", help="Disable Ollama enrichment")
    parser.add_argument("--pretty", action="store_true", help="Pretty-print JSON")
    return parser.parse_args(argv)


def main(argv: list[str] | None = None) -> int:
    load_project_env()
    args = parse_args(argv)
    if hasattr(sys.stdout, "reconfigure"):
        sys.stdout.reconfigure(encoding="utf-8")
    if hasattr(sys.stderr, "reconfigure"):
        sys.stderr.reconfigure(encoding="utf-8")
    log_paths = unique_log_paths(args.inputs)
    missing = [path for path in log_paths if not path.exists()]
    if missing:
        print(f"error: input not found: {missing[0]}", file=sys.stderr)
        return 2
    invalid = [
        path
        for path in log_paths
        if path.is_dir() and not is_processing_dir(path)
    ]
    if invalid:
        print(
            f"error: directory is not a WBPP processing folder "
            f"(.SessionData or numbered pipeline steps): {invalid[0]}",
            file=sys.stderr,
        )
        return 2

    parsed_logs = [
        (label, parse_input(path))
        for label, path in zip(log_labels(log_paths), log_paths)
    ]
    parsed = merge_parse_results(parsed_logs)
    hints = [target_hint_from_path(str(path)) for path in log_paths]
    target_hint = prefer_target_hint(hints, args.target or "")
    specific_hints = [
        hint for hint in dict.fromkeys(hints) if hint and not is_generic_target_hint(hint)
    ]
    if len(specific_hints) > 1:
        parsed.warnings.append(
            f"Multiple target folder names found: {', '.join(specific_hints)}; "
            f"using {target_hint}."
        )
    if len(log_paths) > 1:
        parsed.warnings.append(
            f"Merged {len(log_paths)} inputs: {', '.join(log_labels(log_paths))}."
        )
    simbad: dict[str, Any] = {}
    external_warnings: list[str] = []
    simbad_timeout = float(
        os.environ.get("SIMBAD_TIMEOUT", os.environ.get("WBPP_HTTP_TIMEOUT", "20"))
    )
    ollama_timeout = float(
        os.environ.get("OLLAMA_TIMEOUT", os.environ.get("WBPP_HTTP_TIMEOUT", "120"))
    )

    if not args.no_simbad:
        try:
            simbad, warnings = resolve_simbad(
                target_hint,
                os.environ.get("SIMBAD_TAP_URL", DEFAULT_SIMBAD_URL),
                simbad_timeout,
            )
            external_warnings.extend(warnings)
        except (OSError, ValueError, KeyError, urllib.error.URLError) as exc:
            external_warnings.append(f"SIMBAD lookup failed: {exc}")

        try:
            wikidata, warnings = resolve_wikidata_constellation(
                target_hint,
                simbad,
                os.environ.get("WIKIDATA_API_URL", DEFAULT_WIKIDATA_URL),
                simbad_timeout,
            )
            simbad.update(wikidata)
            external_warnings.extend(warnings)
        except (OSError, ValueError, KeyError, urllib.error.URLError) as exc:
            external_warnings.append(f"Wikidata constellation lookup failed: {exc}")

        try:
            wikipedia, warnings = resolve_wikipedia(
                simbad,
                target_hint,
                os.environ.get("WIKIPEDIA_API_URL", DEFAULT_WIKIPEDIA_URL),
                simbad_timeout,
            )
            if simbad.get("commonName"):
                wikipedia.pop("commonName", None)
                wikipedia.pop("nameSource", None)
            if format_distance(simbad):
                wikipedia.pop("distanceLy", None)
                wikipedia.pop("distanceSource", None)
            simbad.update(wikipedia)
            external_warnings.extend(warnings)
        except (OSError, ValueError, KeyError, urllib.error.URLError) as exc:
            external_warnings.append(f"Wikipedia lookup failed: {exc}")

    enrichment: dict[str, str] = {}
    if not args.no_ollama:
        ollama_host = os.environ.get("OLLAMA_HOST", DEFAULT_OLLAMA_HOST)
        model = resolve_ollama_model(ollama_host, ollama_timeout)
        if not model:
            external_warnings.append(
                "No Ollama model is available; target Body prose was skipped. "
                "Set OLLAMA_MODEL or pull a local model."
            )
        else:
            try:
                enrichment = enrich_with_ollama(
                    target_hint,
                    simbad,
                    model,
                    ollama_host,
                    ollama_timeout,
                )
                if not enrichment.get("bodyMarkdown"):
                    external_warnings.append(
                        f"Ollama model {model} returned an empty Body description."
                    )
            except (
                OSError,
                ValueError,
                KeyError,
                json.JSONDecodeError,
                urllib.error.URLError,
            ) as exc:
                external_warnings.append(f"Ollama enrichment failed: {exc}")

    parsed.warnings.extend(external_warnings)
    draft = build_draft(
        log_paths,
        parsed,
        target_hint,
        simbad,
        enrichment,
        bandwidth=args.bandwidth,
        optics=args.optics,
        sensor=args.sensor,
        sky=args.sky,
        frame_number=args.frame_number,
        revision=args.revision,
    )
    rendered = json.dumps(
        draft,
        ensure_ascii=False,
        indent=2 if args.pretty else None,
        separators=None if args.pretty else (",", ":"),
    ) + "\n"
    if args.output:
        args.output.parent.mkdir(parents=True, exist_ok=True)
        args.output.write_text(rendered, encoding="utf-8")
        print(f"Wrote frame draft: {args.output}", file=sys.stderr)
    else:
        sys.stdout.write(rendered)
    return 0


if __name__ == "__main__":
    raise SystemExit(main())
