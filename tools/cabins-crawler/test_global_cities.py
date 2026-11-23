"""Offline acceptance tests for global 2025 UN city selection."""
from pathlib import Path
import json
import tempfile
import unittest
from xml.sax.saxutils import escape
from zipfile import ZipFile

import crawler
import global_cities
import scope


def make_un_book(path: Path, records: list[tuple[str, str, str, int]]) -> None:
    """Minimal XLSX-shaped OOXML zip, exercising the production stream reader."""
    strings = ["Location", "ISO2_Code", "City_Code", "City_Name",
               "PWCent_Longitude", "PWCent_Latitude", "2025"]
    for code, country, name, _ in records:
        if code not in strings:
            strings.append(code)
        if country not in strings:
            strings.append(country)
        if name not in strings:
            strings.append(name)

    def c(col, row, value, shared=False):
        if shared:
            return f'<c r="{col}{row}" t="s"><v>{strings.index(value)}</v></c>'
        return f'<c r="{col}{row}"><v>{escape(str(value))}</v></c>'

    headings = {
        "B": "Location", "F": "ISO2_Code", "G": "City_Code", "H": "City_Name",
        "J": "PWCent_Longitude", "K": "PWCent_Latitude", "BJ": "2025",
    }
    rows = [
        '<row r="1">' + "".join(c(k, 1, v, True) for k, v in headings.items()) + "</row>"
    ]
    for index, (code, country, name, pop) in enumerate(records, start=2):
        vals = {
            "B": country, "F": code, "G": 10_000 + index, "H": name,
            "J": 139.7, "K": 35.6, "BJ": pop / 1000,
        }
        rows.append(
            f'<row r="{index}">' + "".join(
                c(key, index, val, key in {"B", "H"})
                for key, val in vals.items()
            ) + "</row>"
        )
    # F code values are strings; string-typed inline cells.
    # More robust: encode country codes as shared strings too.
    for row_index, (code, _, _, _) in enumerate(records, start=2):
        code_cell = f'<c r="F{row_index}"><v>{code}</v></c>'
        shared = f'<c r="F{row_index}" t="s"><v>{strings.index(code)}</v></c>'
        rows[row_index - 1] = rows[row_index - 1].replace(code_cell, shared)
    # All country codes must occur in shared strings.
    ss = '<sst xmlns="http://schemas.openxmlformats.org/spreadsheetml/2006/main">' + ''.join(
        f'<si><t>{escape(value)}</t></si>' for value in strings
    ) + "</sst>"
    ws = '<worksheet xmlns="http://schemas.openxmlformats.org/spreadsheetml/2006/main"><sheetData>' + ''.join(rows) + '</sheetData></worksheet>'
    with ZipFile(path, "w") as archive:
        archive.writestr("xl/sharedStrings.xml", ss)
        archive.writestr("xl/worksheets/sheet2.xml", ws)


class GlobalCityCatalogTests(unittest.TestCase):
    def test_owner_exclusions_exact(self):
        self.assertEqual(scope.EXCLUDED_COUNTRY_CODES, {"MM", "BD", "KP", "TL"})
        self.assertEqual(scope.MIN_POPULATION, 1_000_000)

    def test_global_loader_includes_taiwan_russia_japan_and_south_korea(self):
        examples = [
            ("RU", "Russian Federation", "Moscow", 14_524_753),
            ("JP", "Japan", "Tokyo", 33_412_512),
            ("TW", "China, Taiwan Province of China", "Taipei", 9_136_792),
            ("KR", "Republic of Korea", "Seoul", 22_490_482),
            ("KP", "Democratic People's Republic of Korea", "Pyongyang", 2_901_588),
            ("BD", "Bangladesh", "Dhaka", 36_585_479),
            ("MM", "Myanmar", "Yangon", 5_618_303),
            ("TL", "Timor-Leste", "Tiny", 1_500_000),
            ("FR", "France", "Threshold City", 1_000_000),
            ("DE", "Germany", "Large City", 1_100_000),
        ]
        with tempfile.TemporaryDirectory() as directory:
            root = Path(directory)
            source = root / "fixture.xlsx"
            # Include every country code in the shared-string map.
            make_un_book(source, examples)
            cities, manifest = global_cities.load_global_cities(source)
            self.assertEqual(len(cities), 5)
            self.assertEqual({row["country_code"] for row in cities}, {"RU", "JP", "TW", "KR", "DE"})
            self.assertEqual({row["city"] for row in cities},
                             {"Moscow", "Tokyo", "Taipei", "Seoul", "Large City"})
            self.assertEqual(manifest["excluded_urban_areas_by_country"], {
                "BD": 1, "KP": 1, "MM": 1, "TL": 1
            })
            self.assertEqual(manifest["eligible_urban_areas_total"], 5)
            self.assertEqual(next(x for x in cities if x["country_code"] == "TW")["country"], "Taiwan")
            output = root / "world.jsonl"
            global_cities.write_catalog(cities, manifest, output)
            self.assertEqual(len(output.read_text(encoding="utf-8").splitlines()), 5)
            self.assertTrue(output.with_suffix(".csv").exists())
            self.assertTrue(output.with_suffix(".manifest.json").exists())

    def test_wildcard_source_blocks_excluded_countries_even_if_catalog_contains_them(self):
        with tempfile.TemporaryDirectory() as directory:
            path = Path(directory) / "world.jsonl"
            path.write_text("\n".join(json.dumps(x) for x in [
                {"city": "Tokyo", "country_code": "JP", "country": "Japan", "city_code": "1"},
                {"city": "Pyongyang", "country_code": "KP", "country": "North Korea", "city_code": "2"},
                {"city": "Moscow", "country_code": "RU", "country": "Russia", "city_code": "3"},
                {"city": "Dhaka", "country_code": "BD", "country": "Bangladesh", "city_code": "4"},
            ]) + "\n", encoding="utf-8")
            source = {
                "allowed_domains": ["example.com"],
                "country_codes": ["*"],
                "search_url_template": "https://example.com/list?city={city}&country={country_code}",
            }
            urls, position = crawler.city_seed_urls(source, path, 0, batch=10)
            self.assertEqual(position, 2)
            self.assertEqual(urls, [
                "https://example.com/list?city=Tokyo&country=JP",
                "https://example.com/list?city=Moscow&country=RU",
            ])

    def test_explicit_north_korea_source_config_is_rejected(self):
        with tempfile.TemporaryDirectory() as directory:
            path = Path(directory) / "sources.json"
            path.write_text(json.dumps({"sources": [{
                "enabled": True, "name": "Test", "market": "Global", "city": "All",
                "country_codes": ["KP", "JP"], "allowed_domains": ["example.com"],
                "search_url_template": "https://example.com/list?city={city}",
                "listing_link_pattern": r"/listing"
            }]}), encoding="utf-8")
            with self.assertRaisesRegex(ValueError, "Excluded country"):
                crawler.load_config(path)


if __name__ == "__main__":
    unittest.main()
