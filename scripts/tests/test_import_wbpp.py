from __future__ import annotations

import importlib.util
import io
import json
import sys
import tempfile
import unittest
from pathlib import Path
from unittest.mock import patch


SCRIPT = Path(__file__).parents[1] / "import-wbpp.py"
SPEC = importlib.util.spec_from_file_location("import_wbpp", SCRIPT)
assert SPEC and SPEC.loader
wbpp = importlib.util.module_from_spec(SPEC)
sys.modules[SPEC.name] = wbpp
SPEC.loader.exec_module(wbpp)

FIXTURE = Path(__file__).parent / "fixtures" / "wbpp-3.0.1-excerpt.log"


class ParserTests(unittest.TestCase):
    def setUp(self) -> None:
        self.parsed = wbpp.parse_wbpp_log(FIXTURE)

    def test_parses_light_groups_and_ignores_flats(self) -> None:
        acquired = {
            (group.filter_name, group.night): group.total
            for group in self.parsed.calibration_groups
        }
        self.assertEqual(
            acquired,
            {
                ("Ha", "2026-04-27"): 3,
                ("Ha", "2026-05-21"): 2,
                ("OIII", "2026-06-07"): 4,
            },
        )
        self.assertNotIn("SII", {group.filter_name for group in self.parsed.calibration_groups})

    def test_deduplicates_summary_and_maps_integrated_frames_to_nights(self) -> None:
        integrated = {
            group.filter_name: (group.total, group.active)
            for group in self.parsed.integration_groups
        }
        self.assertEqual(integrated, {"Ha": (5, 3), "OIII": (4, 2)})
        self.assertEqual(self.parsed.kept_by_night[("2026-04-27", "Ha")], 2)
        self.assertEqual(self.parsed.kept_by_night[("2026-05-21", "Ha")], 1)
        self.assertEqual(self.parsed.kept_by_night[("2026-06-07", "OIII")], 2)

    def test_builds_admin_shaped_draft(self) -> None:
        draft = wbpp.build_draft(
            FIXTURE,
            self.parsed,
            "V1769 Cyg (WR 134)",
            {},
            {},
            bandwidth="3nm",
            optics="",
            sensor="",
            sky="",
            frame_number="",
            revision="",
        )
        self.assertEqual(draft["frame"]["catalogId"], "WR 134")
        self.assertEqual(draft["frame"]["palette"], "HOO")
        self.assertEqual(draft["frame"]["integrationHours"], 0)
        self.assertEqual(draft["frame"]["integrationMinutes"], 25)
        self.assertEqual(draft["frame"]["capturedOn"], "2026-06-07")
        self.assertEqual(draft["frame"]["plateSessions"], "3 nights · 27 Apr – 07 Jun 2026")
        self.assertEqual(draft["frame"]["opticsLabel"], "RedCat 51 WIFD")
        self.assertEqual(draft["frame"]["sensorLabel"], "QHY Minicam8M (IMX585)")
        self.assertEqual(draft["frame"]["plateSky"], "Bortle 9")
        self.assertEqual(draft["frame"]["arcsecPerPx"], 2.393)
        self.assertEqual(wbpp.plate_scale_arcsec_per_px(), 2.393)
        self.assertEqual(draft["schemaVersion"], 2)
        self.assertEqual(
            [(row["keptFrames"], row["totalFrames"]) for row in draft["filters"]],
            [(3, 5), (2, 4)],
        )
        self.assertEqual(
            [
                (row["integrationHours"], row["integrationMinutes"])
                for row in draft["filters"]
            ],
            [(0, 15), (0, 10)],
        )
        self.assertEqual(sum(row["kept"] for row in draft["nights"]), 5)
        self.assertEqual(sum(row["rejected"] for row in draft["nights"]), 4)
        self.assertTrue(all(row["reason"] == "" for row in draft["nights"]))
        self.assertEqual(
            draft["diagnostics"]["keptIntegration"], {"hours": 0, "minutes": 25}
        )

    def test_partial_log_warns_without_crashing(self) -> None:
        with tempfile.TemporaryDirectory() as directory:
            path = Path(directory) / "partial.log"
            path.write_text("Weighted Batch Preprocessing 3.0.1\nnot a complete run\n")
            parsed = wbpp.parse_wbpp_log(path)
        self.assertEqual(parsed.calibration_groups, [])
        self.assertTrue(any("calibration" in warning for warning in parsed.warnings))
        self.assertTrue(any("ImageIntegration" in warning for warning in parsed.warnings))

    def test_filter_normalization_and_palettes(self) -> None:
        self.assertEqual(wbpp.normalize_filter("H-alpha"), "Ha")
        self.assertEqual(wbpp.normalize_filter("O3"), "OIII")
        self.assertEqual(wbpp.infer_palette(["Ha", "OIII"]), "HOO")
        self.assertEqual(wbpp.infer_palette(["Ha", "OIII", "SII"]), "SHO")
        self.assertEqual(wbpp.infer_palette(["L", "R", "G", "B"]), "LRGB")
        self.assertEqual(wbpp.display_filter("Ha", "3nm"), "Hα 3nm")
        self.assertEqual(wbpp.display_filter("L", "3nm"), "L")
        self.assertEqual(wbpp.display_filter("R", "3nm"), "R")
        filters = [("B", 60), ("OIII", 300), ("SII", 300), ("G", 60),
                   ("Ha", 300), ("R", 60), ("L", 60)]
        self.assertEqual(
            [name for name, _ in sorted(filters, key=wbpp.filter_sort_key)],
            ["SII", "Ha", "OIII", "L", "R", "G", "B"],
        )

    def test_target_hint_uses_folder_before_wbpp(self) -> None:
        path = r"G:\Astro\V1769 Cyg (WR 134)\WBPP\logs\run.log"
        self.assertEqual(wbpp.target_hint_from_path(path), "V1769 Cyg (WR 134)")
        self.assertEqual(wbpp.target_candidates("V1769 Cyg (WR 134)")[0], "WR 134")


class EnrichmentTests(unittest.TestCase):
    @staticmethod
    def payload(columns: list[str], rows: list[list[object]]) -> dict[str, object]:
        return {"metadata": [{"name": name} for name in columns], "data": rows}

    def test_simbad_resolution_collects_aliases_and_distance(self) -> None:
        basic = self.payload(
            ["oid", "main_id", "ra", "dec", "otype", "sp_type", "plx_value"],
            [[123, "HD 191765", 302.559, 36.176, "WR*", "WN6-s", 0.5]],
        )
        aliases = self.payload(
            ["id"],
            [["HD 191765"], ["NAME Crescent Nebula"], ["V* V1769 Cyg"], ["WR 134"]],
        )
        distance = self.payload(
            ["dist", "unit", "minus_err", "plus_err", "bibcode"],
            [[1845.7, "pc", None, None, "2024A&A..."]],
        )
        with patch.object(wbpp, "tap_query", side_effect=[basic, aliases, distance]):
            result, warnings = wbpp.resolve_simbad("WR 134")
        self.assertEqual(result["matched_query"], "WR 134")
        self.assertEqual(result["aliases"][-1], "WR 134")
        self.assertEqual(result["commonName"], "Crescent Nebula")
        self.assertEqual(result["distance"]["unit"], "pc")
        self.assertEqual(warnings, [])
        self.assertEqual(wbpp.constellation_from_aliases(result["aliases"]), "Cygnus")
        self.assertEqual(wbpp.humanize_otype(result["otype"]), "Wolf-Rayet star")
        self.assertEqual(wbpp.format_distance(result), "6,020 ly")
        self.assertEqual(
            wbpp.format_distance({"plx_value": 0.5}),
            "≈ 6,523 ly",
        )
        self.assertEqual(
            wbpp.format_distance({"distanceLy": "3,850 ly"}),
            "3,850 ly",
        )
        self.assertEqual(
            wbpp.format_distance({"plx_value": 0.5, "distanceLy": "3,849 ly"}),
            "3,849 ly",
        )

    def test_simbad_skips_unconvertible_distance_units(self) -> None:
        basic = self.payload(
            ["oid", "main_id", "ra", "dec", "otype", "sp_type", "plx_value"],
            [[123, "WR 134", 302.559, 36.176, "WR*", "WN6-s", None]],
        )
        aliases = self.payload(["id"], [["WR 134"]])
        distance = self.payload(
            ["dist", "unit", "minus_err", "plus_err", "bibcode"],
            [
                [1.0, "mag", None, None, "old"],
                [1845.7, "pc", None, None, "2024A&A..."],
            ],
        )
        with patch.object(wbpp, "tap_query", side_effect=[basic, aliases, distance]):
            result, warnings = wbpp.resolve_simbad("WR 134")
        self.assertEqual(result["distance"]["unit"], "pc")
        self.assertEqual(wbpp.format_distance(result), "6,020 ly")
        self.assertEqual(warnings, [])

    def test_wikidata_constellation_is_verified_against_simbad_coordinates(self) -> None:
        search = {
            "search": [
                {
                    "id": "Q3958756",
                    "label": "Sh 2-114",
                    "aliases": ["Sh2-114"],
                }
            ]
        }
        target = {
            "entities": {
                "Q3958756": {
                    "claims": {
                        "P59": [
                            {
                                "mainsnak": {
                                    "datavalue": {"value": {"id": "Q8921"}}
                                }
                            }
                        ],
                        "P6257": [
                            {
                                "mainsnak": {
                                    "datavalue": {"value": {"amount": "+320.300"}}
                                }
                            }
                        ],
                        "P6258": [
                            {
                                "mainsnak": {
                                    "datavalue": {"value": {"amount": "+38.700"}}
                                }
                            }
                        ],
                        "P2583": [
                            {
                                "mainsnak": {
                                    "datavalue": {
                                        "value": {
                                            "amount": "+1180",
                                            "unit": "http://www.wikidata.org/entity/Q12129",
                                        }
                                    }
                                }
                            }
                        ],
                    }
                }
            }
        }
        constellation = {
            "entities": {
                "Q8921": {"labels": {"en": {"language": "en", "value": "Cygnus"}}}
            }
        }
        with patch.object(
            wbpp, "http_json", side_effect=[search, target, constellation]
        ):
            result, warnings = wbpp.resolve_wikidata_constellation(
                "Sh2-114",
                {"matched_query": "Sh2-114", "ra": 320.3, "dec": 38.7},
            )
        self.assertEqual(result["wikidataId"], "Q3958756")
        self.assertEqual(result["constellation"], "Cygnus")
        self.assertEqual(result["distanceLy"], "3,849 ly")
        self.assertEqual(warnings, [])

    def test_wikipedia_infobox_distance_is_converted_to_light_years(self) -> None:
        wikitext = (
            "{{Infobox nebula\n"
            " | dist_ly = \n"
            " | dist_pc = 1180 ± 100\n"
            " | constellation = Cygnus\n"
            "}}\n"
            "'''Sh 2-114''' (also known as '''Flying Dragon Nebula''') is a faint "
            "emission nebula.\n"
        )
        self.assertEqual(wbpp.parse_wikipedia_distance(wikitext), "3,849 ly")
        self.assertEqual(
            wbpp.parse_wikipedia_common_name(wikitext, "Sh 2-114"),
            "Flying Dragon Nebula",
        )
        self.assertEqual(
            wbpp.parse_wikipedia_distance(
                "{{Infobox nebula\n | dist_ly = {{convert|1180|pc|ly}}\n}}"
            ),
            "3,849 ly",
        )
        self.assertEqual(
            wbpp.parse_wikipedia_common_name("", "Crescent Nebula"),
            "Crescent Nebula",
        )
        self.assertTrue(wbpp.looks_like_catalog_id("Sh2-114"))
        self.assertFalse(wbpp.looks_like_catalog_id("Flying Dragon Nebula"))
        self.assertEqual(
            wbpp.common_name_from_hint("Sh2-114 (Red Dragon Nebula)", "Sh2-114"),
            "Red Dragon Nebula",
        )
        self.assertIn("Sh 2-114", wbpp.wikipedia_title_candidates({}, "Sh2-114"))

        payload = {"parse": {"title": "Sh 2-114", "wikitext": wikitext}}
        with patch.object(wbpp, "http_json", return_value=payload):
            result, warnings = wbpp.resolve_wikipedia(
                {"matched_query": "Sh2-114", "aliases": ["SH  2-114"]},
                "Sh2-114 (Red Dragon Nebula)",
            )
        self.assertEqual(result["distanceLy"], "3,849 ly")
        self.assertEqual(result["distanceSource"], "Wikipedia")
        self.assertEqual(result["commonName"], "Flying Dragon Nebula")
        self.assertEqual(result["wikipediaTitle"], "Sh 2-114")
        self.assertEqual(warnings, [])

    def test_ollama_uses_structured_non_streaming_request(self) -> None:
        response_body = {
            "message": {
                "content": json.dumps(
                    {
                        "bodyMarkdown": (
                            "WR 134 burns in Cygnus. "
                            "It is a Wolf-Rayet star. "
                            "The object lies along the summer Milky Way. "
                            "Its catalog identity is HD 191765."
                        ),
                    }
                )
            }
        }
        captured: dict[str, object] = {}

        def fake_urlopen(request: object, timeout: float) -> io.BytesIO:
            captured["request"] = request
            captured["timeout"] = timeout
            return io.BytesIO(json.dumps(response_body).encode())

        with patch.object(wbpp.urllib.request, "urlopen", side_effect=fake_urlopen):
            result = wbpp.enrich_with_ollama(
                "WR 134",
                {"main_id": "HD 191765", "otype": "WR*"},
                "llama3.2",
                "http://localhost:11434",
                120,
            )

        request = captured["request"]
        payload = json.loads(request.data.decode())
        self.assertEqual(request.full_url, "http://localhost:11434/api/chat")
        self.assertEqual(payload["model"], "llama3.2")
        self.assertFalse(payload["stream"])
        self.assertEqual(payload["format"], wbpp.OLLAMA_SCHEMA)
        self.assertEqual(payload["options"]["temperature"], 0.7)
        self.assertEqual(captured["timeout"], 120)
        self.assertEqual(result["bodyMarkdown"].split(".")[0], "WR 134 burns in Cygnus")
        self.assertEqual(wbpp.sentence_count(result["bodyMarkdown"]), 4)
        self.assertIn("exactly four complete sentences", payload["messages"][1]["content"])

    def test_sentence_count_ignores_empty_fragments(self) -> None:
        self.assertEqual(wbpp.sentence_count("One. Two. Three."), 3)
        self.assertEqual(
            wbpp.sentence_count(
                "In Cygnus, a faint dragon of hydrogen uncoils. It is an H II region."
            ),
            2,
        )

    def test_ollama_retries_when_the_body_is_too_short(self) -> None:
        responses = [
            {"message": {"content": json.dumps({"bodyMarkdown": "Only one sentence."})}},
            {
                "message": {
                    "content": json.dumps(
                        {
                            "bodyMarkdown": (
                                "The Flying Dragon uncoils across Cygnus. "
                                "It is a faint H II region. "
                                "The nebula sits in the summer Milky Way. "
                                "Catalogs place it about 3,849 ly away."
                            )
                        }
                    )
                }
            },
        ]
        captured: list[dict[str, object]] = []

        def fake_urlopen(request: object, timeout: float) -> io.BytesIO:
            captured.append(json.loads(request.data.decode()))
            return io.BytesIO(json.dumps(responses[len(captured) - 1]).encode())

        with patch.object(wbpp.urllib.request, "urlopen", side_effect=fake_urlopen):
            result = wbpp.enrich_with_ollama(
                "Sh2-114",
                {"commonName": "Flying Dragon Nebula", "otype": "HII"},
                "llama3.2",
                "http://localhost:11434",
                120,
            )

        self.assertEqual(len(captured), 2)
        self.assertIn("Too short", captured[1]["messages"][-1]["content"])
        self.assertEqual(wbpp.sentence_count(result["bodyMarkdown"]), 4)

    def test_resolves_ollama_model_from_installed_tags(self) -> None:
        payload = {"models": [{"name": "mistral:latest"}, {"name": "llama3.2:latest"}]}
        with patch.dict("os.environ", {"OLLAMA_MODEL": ""}):
            with patch.object(wbpp, "http_json", return_value=payload):
                self.assertEqual(
                    wbpp.resolve_ollama_model("http://localhost:11434", 5),
                    "llama3.2:latest",
                )

    def test_prefers_explicit_ollama_model(self) -> None:
        with patch.dict("os.environ", {"OLLAMA_MODEL": "custom:tag"}):
            self.assertEqual(
                wbpp.resolve_ollama_model("http://localhost:11434", 5),
                "custom:tag",
            )


if __name__ == "__main__":
    unittest.main()
