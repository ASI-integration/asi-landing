"""Offline tests for all-country SEA settlement coverage and city batching."""
import json
from pathlib import Path
import tempfile
import unittest
from zipfile import ZipFile

import cities
import crawler


def geonames_row(
    geonames_id: int, name: str, country: str, population: int,
    feature: str = "PPL"
) -> str:
    return "\t".join([
        str(geonames_id), name, name, "", "1.25", "103.75",
        "P", feature, country, "", "10", "20", "", "",
        str(population), "", "", "Asia/Singapore", "2026-11-04",
    ])


class SEARegionTests(unittest.TestCase):
    def test_all_eleven_countries_covered(self):
        self.assertEqual(
            set(cities.COUNTRIES),
            {"BN", "KH", "ID", "LA", "MY", "MM", "PH", "SG", "TH", "TL", "VN"},
        )
        self.assertEqual(len(cities.COUNTRIES), 11)

    def test_population_minimum_is_two(self):
        self.assertIsNone(cities.parse_geonames_line(geonames_row(1, "A", "ID", 1), "ID"))
        self.assertIsNone(cities.parse_geonames_line(geonames_row(2, "A", "ID", 0), "ID"))
        self.assertIsNotNone(cities.parse_geonames_line(geonames_row(3, "Tiny", "ID", 2), "ID"))
        self.assertIsNone(cities.parse_geonames_line(geonames_row(4, "Old", "ID", 120), "ID", 200))
        self.assertIsNone(cities.parse_geonames_line(geonames_row(5, "Abandoned", "ID", 200, "PPLQ"), "ID"))

    def test_unknown_population_included_but_not_claimed_two_residents(self):
        raw = geonames_row(55, "Small Place", "TH", 0)
        self.assertIsNone(cities.parse_geonames_line(raw, "TH"))
        candidate = cities.parse_geonames_line(raw, "TH", include_unknown=True)
        self.assertIsNone(candidate["population"])
        self.assertEqual(candidate["population_status"], "unknown")
        self.assertIsNone(cities.parse_geonames_line(geonames_row(56, "One Person", "TH", 1), "TH", include_unknown=True))

    def test_build_catalog_streams_zip_and_manifest(self):
        with tempfile.TemporaryDirectory() as directory:
            root = Path(directory)
            cache = root / "cache"
            cache.mkdir()
            for country in ("ID", "TL"):
                with ZipFile(cache / f"{country}.zip", "w") as archive:
                    archive.writestr(
                        f"{country}.txt",
                        "\n".join([
                            geonames_row(100 if country == "ID" else 200, "Tiny Town", country, 2),
                            geonames_row(101 if country == "ID" else 201, "Unknown", country, 0),
                            geonames_row(102 if country == "ID" else 202, "Big", country, 20000),
                        ]) + "\n"
                    )
            output = root / "cities.jsonl"
            manifest = cities.build_catalog(cache, output, ["ID", "TL"])
            records = [json.loads(line) for line in output.read_text().splitlines()]
            self.assertEqual(len(records), 4)
            self.assertIn("TL", manifest["places_by_country"])
            self.assertEqual(manifest["population_min"], 2)
            self.assertEqual(manifest["places_total"], 4)
            self.assertEqual(manifest["places_by_country"]["ID"], 2)
            self.assertTrue(output.with_suffix(".manifest.json").exists())

    def test_city_search_expansion_and_resume(self):
        with tempfile.TemporaryDirectory() as directory:
            catalog = Path(directory) / "cities.jsonl"
            catalog.write_text(
                "\n".join(json.dumps({
                    "id": f"geonames:{idx}", "name": city,
                    "country_code": country,
                    "country": cities.COUNTRIES[country], "admin1": "10"
                }) for idx, city, country in [
                    (1, "Jakarta", "ID"), (2, "Dili", "TL"),
                    (3, "Banda Aceh", "ID"), (4, "Bandung", "ID"),
                ]) + "\n", encoding="utf-8",
            )
            source = {
                "name": "Approved fixture source",
                "allowed_domains": ["example.com"],
                "country_codes": ["ID"],
                "search_url_template": "https://example.com/search?city={city}&country={country_code}",
            }
            urls, cursor = crawler.city_seed_urls(source, catalog, 0, 2)
            self.assertEqual(cursor, 2)
            self.assertEqual(urls, [
                "https://example.com/search?city=Jakarta&country=ID",
                "https://example.com/search?city=Banda%20Aceh&country=ID",
            ])
            next_urls, next_cursor = crawler.city_seed_urls(source, catalog, cursor, 2)
            self.assertEqual(next_urls, ["https://example.com/search?city=Bandung&country=ID"])
            self.assertEqual(next_cursor, 3)
            self.assertEqual(crawler.city_seed_urls(source, catalog, 3, 2)[0], [])

    def test_city_template_rejects_domains_outside_allowlist(self):
        with tempfile.TemporaryDirectory() as directory:
            catalog = Path(directory) / "cities.jsonl"
            catalog.write_text(json.dumps({
                "id": "geonames:1", "name": "Dili", "country_code": "TL",
                "country": "Timor-Leste"
            }) + "\n")
            source = {
                "country_codes": ["TL"],
                "allowed_domains": ["example.com"],
                "search_url_template": "https://evil.tld/search?city={city}",
            }
            with self.assertRaises(ValueError):
                crawler.city_seed_urls(source, catalog, 0, 1)


if __name__ == "__main__":
    unittest.main()
