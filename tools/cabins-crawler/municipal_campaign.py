#!/usr/bin/env python3
"""Live read-only UK-council commercial listings, initially Hackney London.

No credentials or bypasses. Uses existing crawler robots/HTTPS/DNS validation.
Hackney Council site data: Open Government Licence (site terms link in config).
Each listing is independently identified and has explicit rent period, status,
source, and unverified short-stay/overnight-use caution.
"""
from __future__ import annotations
import argparse
import csv
from datetime import datetime, timezone
from hashlib import sha256
from html.parser import HTMLParser
import json
from pathlib import Path
import re
import time

import crawler

DEFAULT_CONFIG = Path(__file__).with_name("municipal_sources.json")
PRICE = re.compile(r"£\s*(\d[\d,]*(?:\.\d+)?)\s*(?:a\s+year|per\s+annum|p\.?a\.?)", re.I)
M2 = re.compile(r"(\d[\d,]*(?:\.\d+)?)\s*(?:square\s*(?:metres?|meters?)|m²)", re.I)
SQFT = re.compile(r"(\d[\d,]*(?:\.\d+)?)\s*(?:square\s*feet|sq\.?\s*ft)", re.I)
FIELDS = (
    "id", "city", "address", "listing_status", "area_m2",
    "annual_asking_rent_gbp", "monthly_asking_rent_gbp",
    "annual_asking_rent_gbp_per_m2", "listed_planning_class", "source",
    "source_url", "brochure_url", "candidate_score", "legal_use",
    "first_seen", "last_seen", "notes",
)


def norm(t: str) -> str:
    return " ".join(t.split())


class HackneyParser(HTMLParser):
    def __init__(self):
        super().__init__(convert_charrefs=True)
        self.cards = []
        self.card = None
        self.div_depth = 0
        self.in_title = False
        self.hidden = 0

    def handle_starttag(self, tag, attrs):
        a = dict(attrs)
        cls = a.get("class") or ""
        if (self.card is None and tag == "div"
                and "paragraph--type--localgov-featured-teaser" in cls
                and "card" in cls.split()):
            self.card = {"heading": [], "texts": [], "brochure": None}
            self.div_depth = 1
        elif self.card is not None and tag == "div":
            self.div_depth += 1
        if self.card is None:
            return
        if tag in ("script", "style", "noscript"):
            self.hidden += 1
        if tag == "h3":
            self.in_title = True
        if tag == "a" and (a.get("aria-label") or "").lower() == "view brochure":
            href = a.get("href") or ""
            if href.startswith("https://"):
                self.card["brochure"] = href

    def handle_endtag(self, tag):
        if self.card is None:
            return
        if tag == "h3":
            self.in_title = False
        if tag in ("script", "style", "noscript"):
            self.hidden = max(0, self.hidden - 1)
        if tag == "div":
            self.div_depth -= 1
            if self.div_depth == 0:
                c = self.card
                c["address"] = norm(" ".join(c.pop("heading")))
                c["text"] = norm(" ".join(c.pop("texts")))
                if c["address"]:
                    self.cards.append(c)
                self.card = None

    def handle_data(self, text):
        if self.card is not None and not self.hidden:
            t = norm(text)
            if t:
                self.card["texts"].append(t)
                if self.in_title:
                    self.card["heading"].append(t)


def parse_hackney(html: str, source: dict, checked_at: str) -> list[dict]:
    if "Properties to let" not in html or "paragraph--type--localgov-featured-teaser" not in html:
        raise ValueError("Unrecognized council layout, no update")
    parser = HackneyParser()
    parser.feed(html)
    if not 1 <= len(parser.cards) <= 150:
        raise ValueError("Unexpected council cards count, no update")
    found = []
    ids = set()
    for card in parser.cards:
        address, body = card["address"], card["text"]
        m2 = M2.search(body)
        sqft = SQFT.search(body)
        area = round(float(m2.group(1).replace(",", "")), 2) if m2 else (
            round(float(sqft.group(1).replace(",", "")) * 0.09290304, 2)
            if sqft else None
        )
        match = PRICE.search(body)
        annual = float(match.group(1).replace(",", "")) if match else None
        status = "UNDER_OFFER" if "under offer" in body.lower() else "ADVERTISED"
        if area is None and annual is None and status == "ADVERTISED":
            status = "INCOMPLETE_LISTING"
        key = sha256((source["url"] + "|" + address.casefold()).encode()).hexdigest()[:20]
        if key in ids:
            raise ValueError("Duplicate council offer: " + address)
        ids.add(key)
        floor = 2 if address.lower().startswith("second floor") else None
        score, signals, cautions = crawler.rank_property(address, body[:350], area, floor)
        found.append({
            "id": key, "city": "London", "address": address,
            "listing_status": status, "area_m2": area,
            "annual_asking_rent_gbp": annual,
            "monthly_asking_rent_gbp": round(annual / 12, 2) if annual is not None else None,
            "annual_asking_rent_gbp_per_m2": round(annual / area, 2) if annual is not None and area else None,
            "listed_planning_class": "Class E" if "class e" in body.lower() else None,
            "source": source["name"], "source_url": source["url"],
            "brochure_url": card["brochure"], "candidate_score": score,
            "legal_use": "NOT_VERIFIED_FOR_SHORT_STAY_ACCOMMODATION",
            "first_seen": checked_at, "last_seen": checked_at,
            "notes": "Commercial council letting. Not yet confirmed legal for sleeping accommodation; check planning, fire, landlord approval."
        })
    return found


def load_config(path: Path) -> dict:
    config = json.loads(path.read_text(encoding="utf-8"))
    if not isinstance(config.get("sources"), list):
        raise ValueError("Municipal sources must be a list")
    for source in config["sources"]:
        if not source.get("enabled"):
            continue
        if source.get("parser") != "hackney_council_cards_v1":
            raise ValueError("Unverified municipal parser")
        if source.get("allowed_domains") != ["www.hackney.gov.uk"]:
            raise ValueError("Unverified municipal domains")
        if not crawler.allowed_url(source["url"], source["allowed_domains"]):
            raise ValueError("Unapproved municipal URL")
        if source.get("licence") != "UK-OGL-3.0":
            raise ValueError("Unknown public data reuse licence")
    return config


def run_once(config_path: Path, output: Path, execute: bool) -> dict:
    cfg = load_config(config_path)
    enabled = [s for s in cfg["sources"] if s.get("enabled")]
    if not execute:
        return {"mode": "preview", "approved_sources": len(enabled), "network_access": False}
    if not enabled:
        raise ValueError("No approved municipal sources")
    prev_file = output / "municipal-listings.json"
    prev = {}
    if prev_file.is_file():
        data = json.loads(prev_file.read_text(encoding="utf-8"))
        if not isinstance(data, list):
            raise ValueError("Prior listing store invalid")
        prev = {r["id"]: r for r in data}
    checked_at = datetime.now(timezone.utc).isoformat()
    fetched = []
    audits = []
    errors = []
    last_fetch = 0.0
    for source in enabled:
        try:
            if not crawler.robots_permits(source["url"], cfg["user_agent"], {}):
                raise ValueError("robots disallowed/unverifiable")
            remaining = float(cfg.get("delay_seconds", 5)) - (time.monotonic() - last_fetch)
            if last_fetch and remaining > 0:
                time.sleep(remaining)
            html, kind = crawler.fetch_text(source["url"], cfg["user_agent"])
            last_fetch = time.monotonic()
            if "text/html" not in kind:
                raise ValueError("Unexpected response content type")
            cards = parse_hackney(html, source, checked_at)
            fetched.extend(cards)
            audits.append({"source": source["name"], "url": source["url"],
                           "count": len(cards), "terms": source["terms_url"]})
        except Exception as e:
            errors.append({"source": source["name"], "type": type(e).__name__,
                           "detail": str(e)[:160]})
    if errors or not fetched:
        # Fail closed: keep previous snapshot and cursor.
        return {"mode": "BLOCKED", "saved": False, "errors": errors,
                "previous_record_count": len(prev)}
    ids = set()
    events = []
    for row in fetched:
        k = row["id"]
        ids.add(k)
        old = prev.get(k)
        if old is None:
            events.append({"at": checked_at, "event": "NEW", "id": k,
                           "address": row["address"]})
        else:
            row["first_seen"] = old.get("first_seen", checked_at)
            keys = ("listing_status", "annual_asking_rent_gbp", "area_m2")
            if any(row.get(name) != old.get(name) for name in keys):
                events.append({"at": checked_at, "event": "UPDATED", "id": k,
                               "before": {name: old.get(name) for name in keys},
                               "after": {name: row.get(name) for name in keys}})
    for k, old in prev.items():
        if k in ids:
            continue
        missing = dict(old)
        missing["listing_status"] = "NOT_LISTED_VERIFY"
        if old["listing_status"] != "NOT_LISTED_VERIFY":
            events.append({"at": checked_at, "event": "NOT_LISTED", "id": k})
        fetched.append(missing)
    fetched.sort(key=lambda r: (r["listing_status"] != "ADVERTISED",
                               -r["candidate_score"], r["address"]))
    output.mkdir(parents=True, exist_ok=True)
    tmp = output / "municipal-listings.tmp"
    tmp.write_text(json.dumps(fetched, ensure_ascii=False, indent=2) + "\n", encoding="utf-8")
    tmp.replace(prev_file)
    with (output / "municipal-listings.csv").open("w", encoding="utf-8-sig", newline="") as file:
        writer = csv.DictWriter(file, fieldnames=FIELDS)
        writer.writeheader()
        writer.writerows(fetched)
    current = [r for r in fetched if r["listing_status"] == "ADVERTISED"]
    (output / "active-candidates.json").write_text(
        json.dumps(current, ensure_ascii=False, indent=2) + "\n", encoding="utf-8"
    )
    with (output / "municipal-events.jsonl").open("a", encoding="utf-8") as file:
        for event in events:
            file.write(json.dumps(event, ensure_ascii=False) + "\n")
    summary = {
        "mode": "LIVE", "saved": True, "checked_at": checked_at,
        "sources": audits, "total_records": len(fetched),
        "advertised": len(current),
        "under_offer": sum(r["listing_status"] == "UNDER_OFFER" for r in fetched),
        "new": sum(e["event"] == "NEW" for e in events),
        "updated": sum(e["event"] == "UPDATED" for e in events),
        "not_listed": sum(e["event"] == "NOT_LISTED" for e in events),
        "legal_lodging_verified": False, "agents_contacted": False,
    }
    (output / "last-run.json").write_text(json.dumps(summary, ensure_ascii=False, indent=2) + "\n", encoding="utf-8")
    return summary


def main(argv: list[str] | None = None) -> int:
    p = argparse.ArgumentParser(description="Source-compliant council commercial lettings")
    p.add_argument("--config", type=Path, default=DEFAULT_CONFIG)
    p.add_argument("--output", type=Path, required=True)
    p.add_argument("--execute", action="store_true")
    args = p.parse_args(argv)
    result = run_once(args.config, args.output, args.execute)
    print(json.dumps(result, ensure_ascii=False, indent=2))
    return 3 if result["mode"] == "BLOCKED" else 0


if __name__ == "__main__":
    raise SystemExit(main())
