"""Offline acceptance tests. No network, accounts, or production services."""
import json
from pathlib import Path
import tempfile
import unittest
from unittest.mock import patch

import crawler


class CabinCrawlerTests(unittest.TestCase):
    def setUp(self):
        self.source = {
            "name": "Fixture Listings", "market": "Japan", "city": "Osaka",
            "enabled": True, "start_urls": ["https://example.com/search"],
            "allowed_domains": ["example.com"],
            "listing_link_pattern": r"/listing/\d+$",
        }

    def test_area_units(self):
        self.assertAlmostEqual(crawler.first_area("募集面積 55 坪"), 181.8, places=1)
        self.assertEqual(crawler.first_area("Space 65.02 m²"), 65.0)
        self.assertEqual(crawler.first_area("1000 sqft"), 92.9)
        self.assertIsNone(crawler.first_area("No area given"))

    def test_monthly_rent_and_floor(self):
        self.assertEqual(crawler.first_rent("賃料 ¥350,000/月"), (350000, "¥"))
        self.assertEqual(crawler.first_floor("Office 8F/11F"), 8)
        self.assertEqual(crawler.first_floor("辦公室 12樓"), 12)
        self.assertEqual(crawler.first_rent("Sale ¥300,000"), (None, ""))

    def test_http_localhosts_and_cross_domain_are_refused(self):
        with self.assertRaises(ValueError):
            crawler.canonical_url("http://example.com/listing/1")
        with self.assertRaises(ValueError):
            crawler.canonical_url("https://user:pass@example.com/listing/1")
        with self.assertRaises(ValueError):
            crawler.canonical_url("https://example.com:444/listing/1")
        self.assertFalse(crawler.allowed_url("https://evil-example.com/listing/1", ["example.com"]))
        self.assertFalse(crawler.allowed_url("https://localhost/listing/1", ["example.com"]))
        self.assertFalse(crawler.allowed_url("https://example.com.evil.tld/", ["example.com"]))

    def test_listing_and_scoring(self):
        markup = """<html><head><meta name="description" content="For lease"></head>
        <body><h1>Vacant office whole floor, near Osaka station</h1>
        <p>Commercial office 60㎡ on 5F/12F. Monthly rent ¥350,000/月</p></body></html>"""
        item = crawler.extract_listing(
            "https://example.com/listing/42", markup, self.source,
            "2026-11-04T00:00:00+00:00"
        )
        self.assertIsNotNone(item)
        self.assertEqual(item["area_m2"], 60.0)
        self.assertEqual(item["monthly_rent"], 350000)
        self.assertEqual(item["floor"], 5)
        self.assertEqual(item["legal_use"], "UNVERIFIED")
        self.assertGreaterEqual(item["score"], 80)
        self.assertTrue(any("not verified" in caution.lower() for caution in item["cautions"]))

    def test_link_discovery_stays_on_source(self):
        markup = """<a href="/listing/42">Office</a>
        <a href="https://evil.tld/listing/43">Outside</a>
        <a href="http://example.com/listing/44">Downgrade</a>
        <a href="/about">About</a>"""
        links = crawler.discover_links("https://example.com/search", markup, self.source)
        self.assertEqual(links, ["https://example.com/listing/42"])

    def test_end_to_end_fixture_without_network(self):
        pages = {
            "https://example.com/search": '<a href="/listing/42">See property</a>',
            "https://example.com/listing/42": (
                "<html><h1>Office whole floor near station</h1>"
                "<p>空室 70㎡ 3F/9F ¥240,000/月</p></html>"
            ),
        }
        with patch.object(crawler, "robots_permits", return_value=True), \
             patch.object(crawler, "fetch_text", side_effect=lambda url, agent: (pages[url], "text/html")):
            leads, errors = crawler.crawl_source(
                self.source, "ASI-Cabins-Research/0.1", 5, 0, "2026-11-04"
            )
        self.assertFalse(errors)
        self.assertEqual(len(leads), 1)
        self.assertEqual(leads[0]["area_m2"], 70.0)
        self.assertEqual(leads[0]["url"], "https://example.com/listing/42")
        with tempfile.TemporaryDirectory() as directory:
            crawler.export(leads, errors, Path(directory))
            self.assertEqual(len(json.loads((Path(directory) / "leads.json").read_text())), 1)
            self.assertIn("legal_use", (Path(directory) / "leads.csv").read_text(encoding="utf-8-sig"))

    def test_config_preview_has_no_network(self):
        with patch.object(crawler, "fetch_text", side_effect=AssertionError("Network forbidden")):
            code = crawler.main(["--config", str(crawler.DEFAULT_CONFIG)])
        self.assertEqual(code, 0)

    def test_robots_fail_closed(self):
        with patch.object(crawler, "fetch_text", side_effect=OSError("offline")):
            cache = {}
            self.assertFalse(crawler.robots_permits(
                "https://example.com/listing/42", "ASI-Cabins-Research/0.1", cache
            ))


if __name__ == "__main__":
    unittest.main()
