#!/usr/bin/env python3
"""Public-property discovery for ASI indoor micro-cabin pilots.

Read-only, allowlisted HTTPS crawler. No credentials, browsers, or form submission.
Every lead requires human verification of legal lodging use and site feasibility.
"""
from __future__ import annotations

import argparse
import csv
from datetime import datetime, timezone
from hashlib import sha256
from html.parser import HTMLParser
import ipaddress
import json
from pathlib import Path
import re
import socket
import sys
import time
from urllib.error import HTTPError, URLError
from urllib.parse import quote, urljoin, urlsplit, urlunsplit
from urllib.request import HTTPRedirectHandler, Request, build_opener
from urllib.robotparser import RobotFileParser

from scope import EXCLUDED_COUNTRY_CODES

DEFAULT_CONFIG = Path(__file__).with_name("sources.json")
FIELDS = (
    "id", "market", "city", "source", "url", "title", "description",
    "area_m2", "monthly_rent", "currency", "floor", "score",
    "signals", "cautions", "legal_use", "found_at",
)
AREA_RE = re.compile(
    r"(?P<number>\d[\d,.]*)\s*(?P<unit>m²|㎡|sqm|sq\.?\s*m|square\s*met(?:er|re)s|sq\.?\s*ft|square\s*feet|坪|평)",
    re.I,
)
FLOOR_RE = re.compile(r"\b(?P<english>\d{1,2})\s*F\s*/\s*\d{1,2}\s*F\b|(?P<asian>\d{1,2})\s*(?:樓|階|层|層)", re.I)
RENT_RE = re.compile(
    r"(?P<currency>NT\$|TWD|JPY|SGD|HKD|USD|¥|￥|＄|\$|円|元|圓)\s*"
    r"(?P<value>\d[\d,]*)\s*(?:/月|／月|每月|月租|月|per\s*month|/\s*mo|/month)?",
    re.I,
)
RENT_TRAILING_RE = re.compile(r"(?P<value>\d[\d,]*)\s*(?P<currency>元|円|圓)\s*(?:/月|每月|月租|月)", re.I)
KEYWORDS = {
    "commercial": ("office", "commercial", "hostel", "hotel", "business space", "entire floor", "辦公", "商辦", "オフィス", "事務所", "ホテル", "商用", "사무실"),
    "transit": ("station", "metro", "mrt", "subway", "rail", "駅", "徒歩", "捷運", "車站", "步行", "지하철", "역세권"),
    "reuse": ("vacant", "unused", "whole floor", "conversion", "renovation", "空室", "空き", "閒置", "整層", "整棟", "改装", "리모델링"),
    "retail": ("retail", "shop front", "storefront", "street-level", "路面店", "店面", "店鋪"),
}


class ParsedPage(HTMLParser):
    def __init__(self) -> None:
        super().__init__(convert_charrefs=True)
        self.title_parts: list[str] = []
        self.heading_parts: list[str] = []
        self.body_parts: list[str] = []
        self.meta: dict[str, str] = {}
        self.links: list[tuple[str, str]] = []
        self._in_title = False
        self._in_heading = False
        self._hidden_depth = 0
        self._anchor_href: str | None = None
        self._anchor_text: list[str] = []

    def handle_starttag(self, tag: str, attrs: list[tuple[str, str | None]]) -> None:
        a = dict(attrs)
        if tag in ("script", "style", "noscript"):
            self._hidden_depth += 1
        if tag == "title":
            self._in_title = True
        if tag == "h1":
            self._in_heading = True
        if tag == "meta":
            key = (a.get("name") or a.get("property") or "").lower()
            if key and a.get("content"):
                self.meta[key] = a["content"] or ""
        if tag == "a":
            self._anchor_href = a.get("href")
            self._anchor_text = []

    def handle_endtag(self, tag: str) -> None:
        if tag in ("script", "style", "noscript"):
            self._hidden_depth = max(0, self._hidden_depth - 1)
        if tag == "title":
            self._in_title = False
        if tag == "h1":
            self._in_heading = False
        if tag == "a":
            if self._anchor_href:
                self.links.append((self._anchor_href, " ".join(self._anchor_text).strip()))
            self._anchor_href = None
            self._anchor_text = []

    def handle_data(self, data: str) -> None:
        val = " ".join(data.split())
        if not val or self._hidden_depth:
            return
        if self._in_title:
            self.title_parts.append(val)
        if self._in_heading:
            self.heading_parts.append(val)
        if self._anchor_href:
            self._anchor_text.append(val)
        self.body_parts.append(val)

    @property
    def title(self) -> str:
        return " ".join(self.heading_parts or self.title_parts).strip()

    @property
    def description(self) -> str:
        return self.meta.get("description") or self.meta.get("og:description") or ""

    @property
    def text(self) -> str:
        return " ".join(self.body_parts)[:15000]


def canonical_url(raw: str, base: str | None = None) -> str:
    url = urljoin(base, raw) if base else raw
    parts = urlsplit(url)
    if parts.scheme.lower() != "https" or not parts.hostname or parts.username or parts.password:
        raise ValueError("Only credential-free HTTPS URLs are allowed")
    if parts.port not in (None, 443):
        raise ValueError("Nonstandard ports are not allowed")
    return urlunsplit(("https", parts.hostname.lower(), parts.path or "/", parts.query, ""))


def allowed_url(url: str, domains: list[str]) -> bool:
    try:
        host = urlsplit(canonical_url(url)).hostname
    except ValueError:
        return False
    return host in {str(x).lower() for x in domains}


def check_public_dns(url: str) -> None:
    host = urlsplit(url).hostname
    if not host:
        raise ValueError("Missing host")
    addresses = socket.getaddrinfo(host, 443, type=socket.SOCK_STREAM)
    if not addresses or any(not ipaddress.ip_address(item[4][0]).is_global for item in addresses):
        raise ValueError("Non-public DNS address blocked")


class NoRedirect(HTTPRedirectHandler):
    def redirect_request(self, req, fp, code, msg, headers, newurl):
        raise ValueError("Redirect refused; review and allowlist destination explicitly")


OPENER = build_opener(NoRedirect())


def fetch_text(url: str, agent: str, max_bytes: int = 1_000_000) -> tuple[str, str]:
    check_public_dns(url)
    req = Request(url, headers={"User-Agent": agent, "Accept": "text/html,text/plain"})
    with OPENER.open(req, timeout=12) as response:
        content_type = response.headers.get("Content-Type", "").lower()
        if "text/html" not in content_type and "text/plain" not in content_type:
            raise ValueError("Non-HTML response refused")
        body = response.read(max_bytes + 1)
        if len(body) > max_bytes:
            raise ValueError("Response exceeds byte limit")
        match = re.search(r"charset=([\w-]+)", content_type)
        encoding = match.group(1) if match else "utf-8"
        return body.decode(encoding, errors="replace"), content_type


def robots_permits(url: str, agent: str, cache: dict[str, RobotFileParser | None]) -> bool:
    host = urlsplit(url).hostname or ""
    if host not in cache:
        robots_url = "https://" + host + "/robots.txt"
        try:
            text, _ = fetch_text(robots_url, agent, max_bytes=256_000)
            parser = RobotFileParser()
            parser.parse(text.splitlines())
            cache[host] = parser
        except (HTTPError, URLError, OSError, ValueError, UnicodeError):
            cache[host] = None  # Fail closed when robots cannot be verified.
    parser = cache[host]
    return bool(parser and parser.can_fetch(agent, url))


def first_area(text: str) -> float | None:
    for match in AREA_RE.finditer(text):
        value = float(match.group("number").replace(",", ""))
        unit = match.group("unit").lower().replace(" ", "")
        if unit in ("坪",):
            value *= 3.305785
        elif unit == "평":
            value *= 3.305785
        elif unit in ("sqft", "sq.ft", "squarefeet"):
            value *= 0.09290304
        if 10 <= value <= 200_000:
            return round(value, 1)
    return None


def first_rent(text: str) -> tuple[int | None, str]:
    # Require a monthly context to avoid interpreting arbitrary sale prices as rent.
    for pattern in (RENT_RE, RENT_TRAILING_RE):
        for match in pattern.finditer(text):
            vicinity = text[max(0, match.start() - 18):match.end() + 24].lower()
            if not any(s in vicinity for s in ("/月", "／月", "每月", "月租", "/month", "per month", "/mo", "月額", "月")):
                continue
            val = int(match.group("value").replace(",", ""))
            if val > 0:
                return val, match.group("currency")
    return None, ""


def first_floor(text: str) -> int | None:
    match = FLOOR_RE.search(text)
    return int(match.group("english") or match.group("asian")) if match else None


def rank_property(title: str, text: str, area: float | None, floor: int | None) -> tuple[int, list[str], list[str]]:
    haystack = (title + " " + text[:2500]).lower()
    signals: list[str] = []
    cautions: list[str] = ["Hospitality use, fire safety, plumbing and zoning NOT verified"]
    score = 0
    if area is None:
        cautions.append("Area not verified")
    elif 50 <= area <= 100:
        score += 25
        signals.append("50–100 m² pilot potential")
    elif 100 < area <= 1200:
        score += 21
        signals.append("Multi-cabin floor potential")
    elif 25 <= area < 50:
        score += 8
        signals.append("Small-format possibility")
    else:
        cautions.append("Area outside preferred range")
    if any(k in haystack for k in KEYWORDS["commercial"]):
        score += 25
        signals.append("Commercial/hospitality property")
    if any(k in haystack for k in KEYWORDS["transit"]):
        score += 20
        signals.append("Transit-related description")
    if any(k in haystack for k in KEYWORDS["reuse"]):
        score += 15
        signals.append("Potential adaptive reuse")
    if floor is not None and floor >= 2:
        score += 15
        signals.append("Upper floor")
    elif floor == 1:
        cautions.append("Ground-floor unit")
    else:
        cautions.append("Floor not verified")
    if any(k in haystack for k in KEYWORDS["retail"]):
        score -= 20
        cautions.append("Retail/street frontage—lower priority")
    return max(0, min(100, score)), signals, cautions


def extract_listing(url: str, html: str, source: dict, now: str) -> dict | None:
    page = ParsedPage()
    page.feed(html)
    title = page.title
    area = first_area(page.text)
    rent, currency = first_rent(page.text)
    if not title or (area is None and rent is None):
        return None
    floor = first_floor(page.text)
    score, signals, cautions = rank_property(title, page.text, area, floor)
    digest = sha256(url.encode("utf-8")).hexdigest()[:16]
    return {
        "id": digest, "market": source["market"], "city": source["city"],
        "source": source["name"], "url": url, "title": title[:240],
        "description": (page.description or page.text[:360])[:500],
        "area_m2": area, "monthly_rent": rent, "currency": currency,
        "floor": floor, "score": score, "signals": signals,
        "cautions": cautions, "legal_use": "UNVERIFIED", "found_at": now,
    }


def discover_links(base_url: str, html: str, source: dict) -> list[str]:
    page = ParsedPage()
    page.feed(html)
    pattern = re.compile(source["listing_link_pattern"], re.I)
    found: list[str] = []
    for href, _ in page.links:
        try:
            link = canonical_url(href, base_url)
        except ValueError:
            continue
        if allowed_url(link, source["allowed_domains"]) and pattern.search(urlsplit(link).path):
            if link not in found:
                found.append(link)
    return found


def city_seed_urls(
    source: dict, catalog: Path, offset: int = 0, batch: int = 10
) -> tuple[list[str], int]:
    """Return an explicit, bounded batch of search URLs for a verified source.

    Each subsequent run advances --city-offset. Global population filtering
    happens in the catalog importer, not here. A verified source may use
    country_codes=["*"] for worldwide coverage (exclusions still enforced).
    """
    template = source.get("search_url_template")
    codes = set(source.get("country_codes", []))
    if not template or not codes:
        return [], 0
    if codes & EXCLUDED_COUNTRY_CODES:
        raise ValueError("Excluded country present in source policy")
    if offset < 0 or batch < 1 or batch > 50:
        raise ValueError("city offset must be >=0 and batch must be 1..50")
    seeds: list[str] = []
    matched = 0
    with catalog.open(encoding="utf-8") as records:
        for line in records:
            if not line.strip():
                continue
            place = json.loads(line)
            country_code = str(place.get("country_code", "")).upper()
            if country_code in EXCLUDED_COUNTRY_CODES:
                continue
            if "*" not in codes and country_code not in codes:
                continue
            if matched < offset:
                matched += 1
                continue
            if len(seeds) >= batch:
                break
            matched += 1
            substitutions = {
                "city": quote(str(place.get("city") or place.get("name") or ""), safe=""),
                "country": quote(str(place.get("country", "")), safe=""),
                "country_code": quote(str(place["country_code"]), safe=""),
                "admin1": quote(str(place.get("admin1", "")), safe=""),
                "geonames_id": quote(str(place.get("id") or place.get("city_code") or ""), safe=""),
            }
            seed = canonical_url(template.format(**substitutions))
            if not allowed_url(seed, source["allowed_domains"]):
                raise ValueError("City search template expands outside allowlist")
            seeds.append(seed)
    return list(dict.fromkeys(seeds)), matched


def crawl_source(source: dict, agent: str, limit: int, delay: float, now: str, seed_urls: list[str] | None = None) -> tuple[list[dict], list[str]]:
    domains = source["allowed_domains"]
    queue = [canonical_url(x) for x in (seed_urls if seed_urls is not None else source.get("start_urls", []))]
    seen: set[str] = set()
    leads: dict[str, dict] = {}
    errors: list[str] = []
    robots_cache: dict[str, RobotFileParser | None] = {}
    last_fetch = 0.0
    pattern = re.compile(source["listing_link_pattern"], re.I)
    while queue and len(seen) < limit:
        url = queue.pop(0)
        if url in seen or not allowed_url(url, domains):
            continue
        seen.add(url)
        if not robots_permits(url, agent, robots_cache):
            errors.append("SKIPPED robots-unverified/disallowed: " + url)
            continue
        gap = time.monotonic() - last_fetch
        if last_fetch and gap < delay:
            time.sleep(delay - gap)
        try:
            html, content_type = fetch_text(url, agent)
            last_fetch = time.monotonic()
            if "text/html" not in content_type:
                continue
            if pattern.search(urlsplit(url).path):
                item = extract_listing(url, html, source, now)
                if item:
                    leads[item["id"]] = item
            for child in discover_links(url, html, source):
                if child not in seen and child not in queue and len(queue) < limit * 4:
                    queue.append(child)
        except (HTTPError, URLError, OSError, ValueError, UnicodeError) as exc:
            errors.append("SKIPPED " + url + ": " + type(exc).__name__)
    if queue and len(seen) >= limit:
        errors.append("PAGE_CAP_REACHED: more listing URLs remain; do not advance city cursor")
    return list(leads.values()), errors


def load_config(path: Path) -> dict:
    config = json.loads(path.read_text(encoding="utf-8"))
    if not isinstance(config.get("sources"), list):
        raise ValueError("sources must be a list")
    for source in config["sources"]:
        if not source.get("enabled", False):
            continue
        for field in ("name", "market", "city", "allowed_domains", "listing_link_pattern"):
            if not source.get(field):
                raise ValueError("Missing required source field: " + field)
        if not source.get("start_urls") and not source.get("search_url_template"):
            raise ValueError("Source requires start_urls or search_url_template")
        if not all(allowed_url(u, source["allowed_domains"]) for u in source.get("start_urls", [])):
            raise ValueError("Start URLs must be HTTPS and within allowed_domains")
        if source.get("search_url_template"):
            template = source["search_url_template"]
            if set(source.get("country_codes", [])) & EXCLUDED_COUNTRY_CODES:
                raise ValueError("Excluded country present in enabled source country_codes")
            if not source.get("country_codes"):
                raise ValueError("City search source requires country_codes")
            # Prevent template-controlled host or scheme substitutions.
            parsed_template = urlsplit(template)
            if parsed_template.scheme != "https" or "{" in (parsed_template.netloc or ""):
                raise ValueError("City search template must have fixed HTTPS domain")
            sample = template.format(
                city="test", country="test", country_code="XX",
                admin1="test", geonames_id="geonames%3A1"
            )
            if not allowed_url(sample, source["allowed_domains"]):
                raise ValueError("City template must be within allowed domains")
        re.compile(source["listing_link_pattern"])
    return config


def export(leads: list[dict], errors: list[str], output: Path) -> None:
    output.mkdir(parents=True, exist_ok=True)
    leads.sort(key=lambda x: (-x["score"], x["market"], x["city"], x["url"]))
    (output / "leads.json").write_text(json.dumps(leads, ensure_ascii=False, indent=2) + "\n", encoding="utf-8")
    with (output / "leads.csv").open("w", newline="", encoding="utf-8-sig") as stream:
        writer = csv.DictWriter(stream, fieldnames=FIELDS)
        writer.writeheader()
        for item in leads:
            writer.writerow({key: "; ".join(val) if isinstance(val, list) else val for key, val in item.items()})
    (output / "crawl-errors.json").write_text(json.dumps(errors, ensure_ascii=False, indent=2) + "\n", encoding="utf-8")


def main(argv: list[str] | None = None) -> int:
    parser = argparse.ArgumentParser(description="ASI micro-cabins public property discovery")
    parser.add_argument("--config", type=Path, default=DEFAULT_CONFIG)
    parser.add_argument("--output", type=Path, default=Path("cabins-crawler-output"))
    parser.add_argument("--execute", action="store_true", help="Perform public HTTPS GETs; default only validates config")
    parser.add_argument("--city-catalog", type=Path, help="GeoNames JSONL catalog; use verified per-city source templates")
    parser.add_argument("--city-offset", type=int, default=0, help="Per-source starting city index (for batch continuation)")
    parser.add_argument("--city-batch", type=int, default=10, help="Number of cities per source this run, max 50")
    args = parser.parse_args(argv)
    config = load_config(args.config)
    enabled = [source for source in config["sources"] if source.get("enabled", False)]
    print("Configured sources: %s (%s enabled)" % (len(config["sources"]), len(enabled)))
    if not args.execute:
        print("Preview only. Run with --execute to crawl public permitted pages.")
        return 0
    if not enabled:
        print("No enabled sources. Review robots/terms and enable a verified source first.")
        return 2
    agent = config.get("user_agent", "ASI-Cabins-Research/0.1")
    now = datetime.now(timezone.utc).isoformat()
    all_leads: dict[str, dict] = {}
    all_errors: list[str] = []
    if args.city_catalog and not args.city_catalog.is_file():
        parser.error("City catalog not found; build it with cities.py --download")
    if args.city_batch < 1 or args.city_batch > 50 or args.city_offset < 0:
        parser.error("city-batch must be 1..50 and city-offset >= 0")
    for source in enabled:
        seeds = None
        if args.city_catalog:
            seeds, cursor = city_seed_urls(source, args.city_catalog, args.city_offset, args.city_batch)
            if not seeds:
                all_errors.append("NO APPROVED CITY TEMPLATE OR NO REMAINING CITIES: " + source["name"])
                continue
            print(f"{source['name']}: city offset {args.city_offset}, batch {len(seeds)}, next offset {cursor}")
        leads, errors = crawl_source(
            source, agent,
            max(1, min(int(config.get("max_pages_per_source", 15)), 50)),
            max(2.0, float(config.get("delay_seconds", 3))),
            now, seed_urls=seeds,
        )
        all_leads.update({lead["id"]: lead for lead in leads})
        all_errors.extend(errors)
        print("%s: %d candidate leads, %d skipped/errors" % (source["name"], len(leads), len(errors)))
    export(list(all_leads.values()), all_errors, args.output)
    print("Wrote %s/leads.csv and leads.json; %d total leads" % (args.output, len(all_leads)))
    return 0


if __name__ == "__main__":
    sys.exit(main())
