"""Offline acceptance: live London council source collector and persistent changes."""
from pathlib import Path
import json
import tempfile
import unittest
from unittest.mock import patch

import municipal_campaign as municipal


PAGE = """<html><body><h2>Properties to let</h2>
<div class="paragraph paragraph--type--localgov-featured-teaser card">
 <div class="card__content"><h3>Unit 2, Westgate Centre, London E8 3RL</h3>
  <div class="card__body"><p>Class E</p><p>830 square feet / 77.1 square metres</p>
  <p>£29,500 a year</p></div>
  <a aria-label="View brochure" href="https://drive.google.com/file/d/123/view">View brochure</a>
 </div><div class="card__media"><img alt="external imagery"/></div>
</div>
<div class="paragraph paragraph--type--localgov-featured-teaser card">
 <div class="card__content"><h3>Second floor at 6 Test St, London</h3>
   <div class="card__title-prefix">Under offer</div>
   <div class="card__body"><p>Class E</p><p>185 square metres / 2,000 square feet</p>
   <p>£38,000 a year exclusive</p></div>
 </div>
</div></body></html>"""


class MunicipalTests(unittest.TestCase):
    def source(self):
        return {
            "name":"Hackney Council commercial properties to let",
            "enabled":True,"parser":"hackney_council_cards_v1",
            "url":"https://www.hackney.gov.uk/business-and-licensing/commercial-property/let-or-buy-commercial-properties",
            "allowed_domains":["www.hackney.gov.uk"],
            "licence":"UK-OGL-3.0",
            "terms_url":"https://www.hackney.gov.uk/more-us/terms-use"
        }

    def config(self,path):
        path.write_text(json.dumps({"user_agent":"ASI-Cabins-Research/0.1",
                                    "sources":[self.source()]}), encoding="utf-8")

    def test_structured_cards_have_correct_annual_and_monthly_rent(self):
        rows=municipal.parse_hackney(PAGE,self.source(),"2026-11-04")
        self.assertEqual(len(rows),2)
        a,b=rows
        self.assertEqual(a["area_m2"],77.1)
        self.assertEqual(a["annual_asking_rent_gbp"],29500)
        self.assertAlmostEqual(a["monthly_asking_rent_gbp"],2458.33,places=2)
        self.assertEqual(a["listing_status"],"ADVERTISED")
        self.assertEqual(a["listed_planning_class"],"Class E")
        self.assertEqual(a["legal_use"],"NOT_VERIFIED_FOR_SHORT_STAY_ACCOMMODATION")
        self.assertEqual(b["listing_status"],"UNDER_OFFER")
        self.assertEqual(b["annual_asking_rent_gbp"],38000)
        self.assertEqual(a["brochure_url"],"https://drive.google.com/file/d/123/view")

    def test_offline_preview_and_bad_licence(self):
        with tempfile.TemporaryDirectory() as temp:
            path=Path(temp)/"sources.json"
            self.config(path)
            with patch.object(municipal.crawler,"fetch_text",side_effect=AssertionError("network was touched")):
                r=municipal.run_once(path,Path(temp)/"results",False)
            self.assertEqual(r["mode"],"preview")
            bad=self.source();bad["licence"]="UNVERIFIED"
            path.write_text(json.dumps({"user_agent":"a","sources":[bad]}),encoding="utf-8")
            with self.assertRaises(ValueError):
                municipal.load_config(path)

    def test_two_runs_do_not_duplicate_ids_and_fail_closed(self):
        with tempfile.TemporaryDirectory() as temp:
            root=Path(temp);config=root/"sources.json"
            self.config(config)
            with patch.object(municipal.crawler,"robots_permits",return_value=True):
                with patch.object(municipal.crawler,"fetch_text",return_value=(PAGE,"text/html")):
                    first=municipal.run_once(config,root/"out",True)
                    second=municipal.run_once(config,root/"out",True)
                with patch.object(municipal.crawler,"fetch_text",side_effect=ValueError("blocked")):
                    third=municipal.run_once(config,root/"out",True)
            self.assertEqual(first["advertised"],1)
            self.assertEqual(first["under_offer"],1)
            self.assertEqual(first["new"],2)
            self.assertEqual(second["new"],0)
            self.assertEqual(second["updated"],0)
            self.assertEqual(third["mode"],"BLOCKED")
            self.assertFalse(third["saved"])
            saved=json.loads((root/"out"/"municipal-listings.json").read_text(encoding="utf-8"))
            self.assertEqual(len(saved),2)
            candidates=json.loads((root/"out"/"active-candidates.json").read_text(encoding="utf-8"))
            self.assertEqual(len(candidates),1)
            events=(root/"out"/"municipal-events.jsonl").read_text(encoding="utf-8").splitlines()
            self.assertEqual(len(events),2)

    def test_source_drops_listing_marks_it_not_listed(self):
        with tempfile.TemporaryDirectory() as temp:
            root=Path(temp);cfg=root/"config.json"
            self.config(cfg)
            reduced=PAGE.split('<div class="paragraph paragraph--type--localgov-featured-teaser card">')[0]+(
                '<div class="paragraph paragraph--type--localgov-featured-teaser card">'
                +PAGE.split('<div class="paragraph paragraph--type--localgov-featured-teaser card">')[1]
            )
            with patch.object(municipal.crawler,"robots_permits",return_value=True), \
                 patch.object(municipal.crawler,"fetch_text",side_effect=[
                     (PAGE,"text/html"),(reduced,"text/html")
                 ]):
                first=municipal.run_once(cfg,root/"out",True)
                later=municipal.run_once(cfg,root/"out",True)
            self.assertEqual(first["total_records"],2)
            self.assertEqual(later["total_records"],2)
            self.assertEqual(later["not_listed"],1)
            self.assertEqual(later["advertised"],1)

    def test_changed_layout_refuses_to_delete_previous_results(self):
        with self.assertRaises(ValueError):
            municipal.parse_hackney("<html><h2>Properties to let</h2></html>",self.source(),"today")


if __name__=="__main__":
    unittest.main()
