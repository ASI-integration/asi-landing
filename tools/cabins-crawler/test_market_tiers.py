"""Tier regression tests: strong demand does not imply verified profit or Evergreen."""
from pathlib import Path
import json
import tempfile
import unittest

import market_tiers


def city(name="Tokyo", code="JP", score=80, city_arrivals="22000000",
         risk="NO_AUTOMATIC_BLOCK", homicide="0.2", gpi="1.3",
         city_evidence="5", demand="35", pop="12000000", grade="A-city-data",
         rank="1"):
    return {
        "rank": rank, "city": name, "country": code, "country_code": code,
        "population_2025": pop, "screening_score_100": score,
        "priority_band": "A-PRIORITY", "evidence_grade": grade,
        "country_tourist_arrivals": "36000000", "city_arrivals_2025": city_arrivals,
        "demand_basis": "verified_2025_city" if city_arrivals else "country_proxy",
        "homicides_per_100k": homicide, "gpi_safety_2026": gpi,
        "risk_review": risk, "city_evidence_score_10": city_evidence,
        "demand_score_40": demand,
    }


class TierRulesTests(unittest.TestCase):
    def test_city_confirmed_high_has_no_fabricated_investment_metrics(self):
        t = market_tiers.bands(city())
        self.assertEqual(t["research_tier"], "I-HIGH")
        self.assertEqual(t["demand_band"], "HIGH")
        self.assertEqual(t["population_band"], "HIGH")
        self.assertEqual(t["profitability_band"], "UNVERIFIED_NO_SITE_COSTS")
        self.assertEqual(t["evergreen_band"], "UNVERIFIED_NO_ASI_SITE_REPORT")
        self.assertEqual(t["financing_research_priority"], "RESEARCH_FIRST")

    def test_country_only_popularity_is_insufficient_for_top_tier(self):
        c=city(name="Generic Suburb",city_arrivals="",city_evidence="0",
               score="75",demand="27",grade="A-country-data")
        t=market_tiers.bands(c)
        self.assertEqual(t["research_tier"], "II-MEDIUM")
        self.assertEqual(t["demand_band"], "MEDIUM")

    def test_mecca_high_demand_requires_special_foreign_market_access_review(self):
        mecca = city(name="Mecca", code="SA", score="69",
                     city_arrivals="18700000",city_evidence="5",
                     demand="34",homicide="0.7",gpi="2.5")
        category = market_tiers.bands(mecca)
        self.assertEqual(category["research_tier"], "II-MEDIUM")
        self.assertEqual(category["market_access_gate"], "SPECIAL_EXTERNAL_INVESTOR_RULES_VERIFY")
        self.assertEqual(category["next_gate"], "LOCAL_FOREIGN_OWNERSHIP_AND_HOTEL_OPERATOR_ELIGIBILITY")
        self.assertEqual(category["financing_research_priority"], "CHECK_FOREIGN_INVESTOR_ELIGIBILITY_FIRST")

    def test_moscow_local_demand_enters_conditional_second_group_not_first(self):
        c=city(name="Moskva (Moscow)",code="RU",score="20.99",city_arrivals="",
               risk="ELEVATED_COUNTRY_RISK_REVIEW",gpi="2.876",
               homicide="7.82",city_evidence="0",demand="0",grade="B-incomplete",
               pop="14524753")
        s={"city_visitors_2025":"26500000","city_stability_proxy_100":"82.73"}
        t=market_tiers.bands(c,s)
        self.assertEqual(t["research_tier"], "II-MEDIUM")
        self.assertEqual(t["risk_gate"], "COUNTRY_RISK_REVIEW")
        self.assertEqual(t["financing_research_priority"], "RESEARCH_CONDITIONAL")
        self.assertEqual(t["next_gate"], "COUNTRY_AND_CITY_RISK_CLEARANCE")
        self.assertEqual(t["demand_band"],"HIGH")
        self.assertEqual(t["stability_band"],"MEDIUM")

    def test_missing_country_safety_blocks_high_class(self):
        c=city(name="Bangkok",code="TH",score=73,city_arrivals="30000000",
               risk="COUNTRY_RISK_DATA_MISSING",homicide="",gpi="",demand="40")
        t=market_tiers.bands(c)
        self.assertNotEqual(t["research_tier"],"I-HIGH")
        self.assertEqual(t["risk_gate"],"COUNTRY_SAFETY_EVIDENCE_REVIEW")

    def test_excluded_country_refused(self):
        with self.assertRaises(ValueError):
            market_tiers.bands(city(name="Pyongyang",code="KP"))

    def test_three_queues_preserve_original_and_no_company_or_funding_claims(self):
        rows=[
            city(name="Tokyo"),
            city(name="Osaka",score="70",city_arrivals="",city_evidence="0",demand="26",rank="2"),
            city(name="City with no evidence",code="XX",score="8",city_arrivals="",
                 city_evidence="0",grade="C-sparse",demand="0",
                 risk="COUNTRY_RISK_DATA_MISSING",homicide="",gpi="",rank="3"),
        ]
        data, manifest=market_tiers.group_markets(rows,[])
        self.assertEqual(len(data),3)
        self.assertEqual(set(r["research_tier"] for r in data),
                         {"I-HIGH","II-MEDIUM","III-RESERVE"})
        self.assertEqual(manifest["review_status"]["financing_programs_verified"],0)
        self.assertTrue(all(r["local_partner_interest_status"]=="NOT_VERIFIED" for r in data))
        self.assertTrue(all(r["asi_evergreen_index"] is None for r in data))
        self.assertTrue(all(r["expected_net_margin"] is None for r in data))
        with tempfile.TemporaryDirectory() as d:
            output=Path(d)
            market_tiers.write_tiers(data,manifest,output)
            lines=sum(len(p.read_text(encoding="utf-8").splitlines())
                      for p in output.glob("city-catalog-*.jsonl"))
            self.assertEqual(lines,3)
            self.assertTrue((output/"market-tiers-2026.csv").exists())

    def test_no_duplicate_city_country(self):
        c=city()
        with self.assertRaisesRegex(ValueError,"Duplicate"):
            market_tiers.group_markets([c,c],[])

if __name__ == "__main__":
    unittest.main()
