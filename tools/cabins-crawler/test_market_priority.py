"""Offline tests for comparable, source-traced global market screening."""
import csv
import json
from pathlib import Path
import tempfile
import unittest

import market_priority
from scope import EXCLUDED_COUNTRY_CODES


class MarketPriorityTests(unittest.TestCase):
    def test_2025_city_signals_and_weights(self):
        self.assertEqual(market_priority.normalized_city("JP", "Tōkyō (Tokyo)"), "tokyo")
        self.assertEqual(market_priority.normalized_city("TH", "Krung Thep Maha Nakhon (Bangkok)"), "bangkok")
        self.assertEqual(market_priority.normalized_city("RU", "Moskva (Moscow)"), "moskva moscow")
        score = market_priority.component_scores(10_000_000, 36_000_000, 0.5, 1.3, ("JP", "tokyo"))
        self.assertEqual(score[3], 5)
        self.assertTrue(0 <= sum(score) <= 100)
        self.assertEqual(market_priority.component_scores(1_010_000, None, None, None, ("XX", "nope"))[:2], (0.0, 0.0))

    def test_primary_model_with_country_proxy_and_high_risk(self):
        with tempfile.TemporaryDirectory() as directory:
            p = Path(directory)
            catalog = [
                {"city": "Paris", "country": "France", "country_code": "FR", "city_code": "1", "population_2025": 12_000_000},
                {"city": "Cairo", "country": "Egypt", "country_code": "EG", "city_code": "2", "population_2025": 18_000_000},
                {"city": "Ouagadougou", "country": "Burkina Faso", "country_code": "BF", "city_code": "3", "population_2025": 3_000_000},
                {"city": "Moscow", "country": "Russia", "country_code": "RU", "city_code": "4", "population_2025": 14_000_000},
                {"city": "Pyongyang", "country": "North Korea", "country_code": "KP", "city_code": "5", "population_2025": 3_000_000},
                {"city": "Small", "country": "France", "country_code": "FR", "city_code": "6", "population_2025": 700_000},
            ]
            (p / "world.jsonl").write_text(
                "\n".join(json.dumps(x) for x in catalog) + "\n", encoding="utf-8"
            )
            (p / "countryInfo.txt").write_text(
                "FR\tFRA\nEG\tEGY\nBF\tBFA\nRU\tRUS\nKP\tPRK\n", encoding="utf-8"
            )
            def csvfile(name, header, rows):
                with (p / name).open("w", newline="", encoding="utf-8") as file:
                    writer = csv.writer(file)
                    writer.writerow(header)
                    writer.writerows(rows)
            csvfile("tourism.csv", ["Entity", "Code", "Year", "Arrivals of tourists from abroad"], [
                ["France", "FRA", 2024, 48_400_000],
                ["Egypt", "EGY", 2024, 11_600_000],
                ["Burkina Faso", "BFA", 2024, 200_000],
                ["Russia", "RUS", 2024, 8_000_000],
            ])
            csvfile("homicide.csv", ["Entity", "Code", "Year", "Homicide rate per 100,000 population"], [
                ["France", "FRA", 2024, 1.2], ["Egypt", "EGY", 2023, 2.3],
                ["Burkina Faso", "BFA", 2023, 3.5], ["Russia", "RUS", 2023, 7.8]
            ])
            csvfile("gpi.csv", [
                "iso3", "country", "overall_score_2026", "safety_security_score_2026", "ongoing_conflict_score_2026"
            ], [
                ["FRA", "France", 2.08, 1.8, 1.7],
                ["EGY", "Egypt", 2.19, 2.5, 2.0],
                ["BFA", "Burkina Faso", 2.88, 3.2, 3.4],
                ["RUS", "Russia", 3.367, 2.8, 4.03],
            ])
            scored, manifest = market_priority.ranked_markets(
                p / "world.jsonl", p / "tourism.csv", p / "homicide.csv",
                p / "gpi.csv", p / "countryInfo.txt"
            )
            self.assertEqual(len(scored), 4)
            by = {r["city"]: r for r in scored}
            self.assertGreater(by["Cairo"]["screening_score_100"], by["Ouagadougou"]["screening_score_100"])
            self.assertEqual(by["Moscow"]["priority_band"], "SAFETY_REVIEW")
            self.assertEqual(by["Ouagadougou"]["priority_band"], "SAFETY_REVIEW")
            self.assertEqual(by["Paris"]["verified_destination_top10"], True)
            self.assertEqual(by["Paris"]["commercial_property_rent"], None)
            self.assertEqual(manifest["cities"], 4)
            market_priority.save_outputs(scored, manifest, p / "output")
            with (p / "output" / "market-priority-2026.csv").open(encoding="utf-8-sig") as exported:
                self.assertEqual(len(list(csv.DictReader(exported))), 4)
            self.assertEqual(len((p / "output" / "ranked-city-catalog-all.jsonl").read_text().splitlines()), 4)
            self.assertGreater(len((p / "output" / "ranked-city-catalog-focus.jsonl").read_text().splitlines()), 0)

    def test_unknown_tourism_not_falsely_interpreted_as_zero_arrivals(self):
        with tempfile.TemporaryDirectory() as directory:
            f = Path(directory) / "tourism.csv"
            f.write_text("Entity,Code,Year,Arrivals of tourists from abroad\nJapan,JPN,2015,20000000\n",encoding="utf-8")
            self.assertIsNone(market_priority.timeseries(f, "Arrivals of tourists from abroad").get("JPN"))

    def test_exclusion_policy_persists(self):
        self.assertEqual(set(EXCLUDED_COUNTRY_CODES), {"BD", "MM", "KP", "TL"})


if __name__ == "__main__":
    unittest.main()
