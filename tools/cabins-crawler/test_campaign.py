"""Resumable campaign acceptance tests; no external requests."""
import json
from pathlib import Path
import tempfile
import unittest
from unittest.mock import patch

import campaign
import crawler


class CampaignTests(unittest.TestCase):
    def setUp(self):
        self.config = {
            "user_agent": "ASI-Cabins-Research/0.1",
            "delay_seconds": 3,
            "max_pages_per_source": 10,
            "sources": [{
                "name": "Fixture property source",
                "market": "SEA", "city": "Regional",
                "enabled": True,
                "country_codes": ["ID"],
                "search_url_template": "https://example.com/properties?city={city}",
                "allowed_domains": ["example.com"],
                "listing_link_pattern": r"/listing/\d+$",
            }],
        }

    @staticmethod
    def write_catalog(path):
        path.write_text(
            "\n".join(json.dumps({
                "id": f"geonames:{i}", "name": name,
                "country_code": "ID", "country": "Indonesia",
            }) for i, name in [(1, "Jakarta"), (2, "Bandung")]) + "\n",
            encoding="utf-8",
        )

    def test_approved_source_configuration(self):
        with tempfile.TemporaryDirectory() as d:
            path = Path(d) / "config.json"
            path.write_text(json.dumps(self.config), encoding="utf-8")
            self.assertEqual(crawler.load_config(path)["sources"][0]["country_codes"], ["ID"])

    def test_preview_is_offline_and_does_not_create_state(self):
        with tempfile.TemporaryDirectory() as d:
            root = Path(d)
            catalog = root / "cities.jsonl"
            self.write_catalog(catalog)
            with patch.object(crawler, "crawl_source", side_effect=AssertionError("Network forbidden")):
                result = campaign.run_once(self.config, catalog, root / "results", 2, False)
            self.assertEqual(result["mode"], "preview")
            self.assertFalse((root / "results" / "campaign-state.json").exists())

    def test_resume_without_losing_prior_leads(self):
        with tempfile.TemporaryDirectory() as d:
            root = Path(d)
            catalog = root / "cities.jsonl"
            output = root / "results"
            self.write_catalog(catalog)
            one = {"id": "one", "score": 65, "market": "SEA", "city": "Jakarta", "url": "https://example.com/listing/1"}
            two = {"id": "two", "score": 70, "market": "SEA", "city": "Bandung", "url": "https://example.com/listing/2"}
            with patch.object(crawler, "crawl_source", side_effect=[([one], []), ([two], [])]) as fetch:
                first = campaign.run_once(self.config, catalog, output, 1, True)
                second = campaign.run_once(self.config, catalog, output, 1, True)
            self.assertEqual(fetch.call_count, 2)
            self.assertEqual(first["processed"], 1)
            self.assertEqual(second["processed"], 1)
            self.assertEqual(second["leads_total"], 2)
            self.assertEqual(second["source_offsets"]["Fixture property source"], 2)
            rows = json.loads((output / "leads.json").read_text(encoding="utf-8"))
            self.assertEqual({row["id"] for row in rows}, {"one", "two"})

    def test_blocked_crawl_does_not_advance_cursor(self):
        with tempfile.TemporaryDirectory() as d:
            root = Path(d)
            catalog = root / "cities.jsonl"
            self.write_catalog(catalog)
            with patch.object(crawler, "crawl_source", return_value=([], ["PAGE_CAP_REACHED"])):
                result = campaign.run_once(self.config, catalog, root / "out", 2, True)
            self.assertEqual(result["processed"], 0)
            self.assertEqual(result["source_offsets"]["Fixture property source"], 0)
            self.assertEqual(result["blocked"], ["Fixture property source"])

    def test_disabled_sources_not_runnable(self):
        with tempfile.TemporaryDirectory() as d:
            root = Path(d)
            catalog = root / "cities.jsonl"
            self.write_catalog(catalog)
            config = json.loads(json.dumps(self.config))
            config["sources"][0]["enabled"] = False
            with self.assertRaisesRegex(ValueError, "No approved"):
                campaign.run_once(config, catalog, root / "out", 1, True)


if __name__ == "__main__":
    unittest.main()
