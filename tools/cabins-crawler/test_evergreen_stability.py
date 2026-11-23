"""Acceptance checks: city-level stability is not the property Evergreen score."""
from __future__ import annotations

import csv
import json
from pathlib import Path
import tempfile
import unittest

import city_resilience
import evergreen_bridge


class ResilienceTests(unittest.TestCase):
    def test_two_year_snapshots_are_measured_and_not_profit_forecasts(self):
        with tempfile.TemporaryDirectory() as d:
            root = Path(d)
            cities = [
                {"city": "Moskva (Moscow)", "city_code": "2485", "country_code": "RU"},
                {"city": "New York City", "city_code": "8354", "country_code": "US"},
                {"city": "Osaka", "city_code": "3", "country_code": "JP"},
            ]
            (root / "world.jsonl").write_text("\n".join(json.dumps(x) for x in cities)+"\n",encoding="utf-8")
            benchmark = {
                "cities": [
                    {"country_code": "RU", "city_code": "2485", "display_name": "Moscow",
                     "hotel_occupancy_pct": {"2024": 76, "2025": 73.7},
                     "city_visitors_millions": {"2024": 26, "2025": 26.5},
                     "city_domestic_visitors_millions_2025": 23.7,
                     "adr_2025": {"value": 10400, "currency": "RUB"},
                     "sources":[{"url":"https://example.org/russia1"}, {"url":"https://example.org/russia2"}]},
                    {"country_code": "US", "city_code": "8354", "display_name": "New York City",
                     "hotel_occupancy_pct": {"2024": 84.3, "2025": 84.1},
                     "city_visitors_millions": {"2024": 64.5, "2025": 65},
                     "city_domestic_visitors_millions_2025": 52.4,
                     "adr_2025": {"value": 333.71, "currency": "USD"},
                     "sources":[{"url":"https://example.org/ny1"}, {"url":"https://example.org/ny2"}]},
                ],
            }
            (root / "bench.json").write_text(json.dumps(benchmark), encoding="utf-8")
            with (root / "market.csv").open("w", encoding="utf-8", newline="") as stream:
                w = csv.DictWriter(stream,fieldnames=[
                    "rank","screening_score_100","priority_band","city","country",
                    "country_code","population_2025","risk_review"
                ])
                w.writeheader()
                w.writerows([
                    {"rank": 432,"screening_score_100": 20.99,"priority_band": "SAFETY_REVIEW",
                     "city": "Moskva (Moscow)","country":"Russia","country_code":"RU",
                     "population_2025":14524753,"risk_review":"ELEVATED_COUNTRY_RISK_REVIEW"},
                    {"rank": 20, "screening_score_100": 61.0,"priority_band": "B-SHORTLIST",
                     "city": "New York City","country":"United States of America",
                     "country_code":"US","population_2025":13920148,
                     "risk_review":"NO_AUTOMATIC_BLOCK"},
                    {"rank": 7, "screening_score_100":70.58,"priority_band": "B-SHORTLIST",
                     "city":"Osaka","country":"Japan","country_code":"JP",
                     "population_2025":12964145,"risk_review":"NO_AUTOMATIC_BLOCK"},
                ])
            rows, manifest = city_resilience.build_overlay(
                root / "market.csv", root / "bench.json", root / "world.jsonl"
            )
            self.assertEqual(len(rows), 3)
            m, ny, osaka = rows
            self.assertEqual(manifest["city_stability_observed"], 2)
            self.assertEqual(m["hotel_occupancy_change_pp"], -2.3)
            self.assertEqual(ny["hotel_occupancy_change_pp"], -0.2)
            self.assertGreater(ny["city_stability_proxy_100"], m["city_stability_proxy_100"])
            self.assertGreater(m["domestic_share_2025_pct"], ny["domestic_share_2025_pct"])
            self.assertIsNone(osaka["city_stability_proxy_100"])
            self.assertIsNone(m["evergreen_index"])
            self.assertIsNone(ny["magnet_count"])
            self.assertIsNone(m["commercial_rent"])
            self.assertEqual(m["global_priority_band"], "SAFETY_REVIEW")
            city_resilience.export(rows,manifest,root/"output")
            with (root/"output"/"city-stability-overlay.csv").open(encoding="utf-8-sig") as fh:
                self.assertEqual(len(list(csv.DictReader(fh))),3)

    def test_partial_or_unmatched_data_rejected(self):
        with self.assertRaises(ValueError):
            city_resilience.stability_snapshot({
                "hotel_occupancy_pct":{"2024":80,"2025":110},
                "city_visitors_millions":{"2024":10,"2025":11},
                "city_domestic_visitors_millions_2025":9,
                "adr_2025":{"value":100,"currency":"USD"},
                "sources":[{"url":"https://example.org/1"}]
            })


class EvergreenBridgeTests(unittest.TestCase):
    def case(self):
        return {
            "location_id":"moscow-site-001", "country_code":"RU", "city_code":"2485",
            "latitude":55.75,"longitude":37.62,
            "analysis":{
                "analysisIntegrity":{
                    "analysisIncomplete":False,
                    "scoreBlockedDueToIncompleteData":False,
                },
                "evergreenIndex":80,
                "locationScore":{
                    "location_score":73,
                    "breakdown":{"magnet_score":60, "demand_score":72, "seasonality_score":64},
                },
                "magnets":[
                    {"categoryId":"metro","name":"Station","distance":190,
                     "weight":9,"attractionScore":7.1,"permanenceType":"permanent"},
                    {"categoryId":"specializedMedicalAnchor","name":"Clinic","distance":2300,
                     "weight":4.5,"attractionScore":0.9,"permanenceType":"permanent"},
                ]
            }
        }

    def test_preserves_original_core_evergreen_without_recomputing(self):
        value=evergreen_bridge.location_record(self.case())
        self.assertEqual(value["status"],"VERIFIED_ASI_SITE_EVIDENCE")
        self.assertEqual(value["evergreen_index"],80)
        self.assertEqual(value["magnet_score"],60)
        self.assertEqual(value["demand_score"],72)
        self.assertEqual(value["magnet_count"],2)
        self.assertEqual(value["top_magnets"][0]["category"],"metro")
        self.assertEqual(value["top_magnets"][0]["distance_m"],190.0)
        self.assertEqual(value["location_score"],73)
        self.assertEqual(value["source_engine"],"ASI-integration/asi-landing src/lib/location")

    def test_bad_integrity_refuses_scores(self):
        value=self.case()
        value["analysis"]["analysisIntegrity"]["analysisIncomplete"]=True
        r=evergreen_bridge.location_record(value)
        self.assertEqual(r["status"],"BLOCKED_OR_UNVERIFIED_ENGINE_EVIDENCE")
        self.assertIsNone(r["evergreen_index"])
        self.assertIsNone(r["magnet_score"])

    def test_no_address_or_missing_score_yields_no_index(self):
        value=self.case()
        value["analysis"]["locationScore"]["breakdown"].pop("magnet_score")
        r=evergreen_bridge.location_record(value)
        self.assertNotEqual(r["status"],"VERIFIED_ASI_SITE_EVIDENCE")
        self.assertIsNone(r["evergreen_index"])
        value=self.case()
        value.pop("latitude")
        with self.assertRaises(ValueError):
            evergreen_bridge.location_record(value)


if __name__=="__main__":
    unittest.main()
