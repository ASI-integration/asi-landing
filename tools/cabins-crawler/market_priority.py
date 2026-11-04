#!/usr/bin/env python3
"""Global preliminary market-screening ranking for ASI Cabins.

Not a rent, occupancy, ROI or city crime forecast. Country indicators are
country-level proxies; priority status does not confirm property feasibility.
Inputs: UN WUP cities >1m, UN Tourism via OWID, UNODC homicide via OWID,
IEP GPI 2026, GeoNames ISO code mapping. Top-10 city evidence: Euromonitor 2025.
No network access and no production/Engine side effects.
"""
from __future__ import annotations

import argparse
import csv
from collections import Counter
from datetime import datetime, timezone
from hashlib import sha256
import json
import math
from pathlib import Path
import re
import unicodedata

from scope import EXCLUDED_COUNTRY_CODES

TOURISM_URL = "https://ourworldindata.org/grapher/international-tourist-trips"
HOMICIDE_URL = "https://ourworldindata.org/grapher/homicide-rate-unodc"
GPI_URL = "https://gpi.economicsandpeace.org/"
CITY_EVIDENCE_URL = "https://lp.euromonitor.com/newsroom/press-releases/december-2025/euromonitor-international-unveils-worlds-top-100-city-destinations-for-2025"
GEONAMES_URL = "https://download.geonames.org/export/dump/countryInfo.txt"

# Euromonitor 2025 published top tens; these are positive public evidence,
# not a full census of cities. Lack of entry is NOT evidence of zero tourism.
CITY_ARRIVALS_2025 = {
    ("TH", "bangkok"): 30_300_000,
    ("HK", "hong kong"): 23_200_000,
    ("GB", "london"): 22_700_000,
    ("MO", "macau"): 20_400_000,
    ("TR", "istanbul"): 19_700_000,
    ("AE", "dubai"): 19_500_000,
    ("SA", "mecca"): 18_700_000,
    ("TR", "antalya"): 18_600_000,
    ("FR", "paris"): 18_300_000,
    ("MY", "kuala lumpur"): 17_300_000,
}
TOP_ARRIVALS_2025 = frozenset(CITY_ARRIVALS_2025)
TOP_DESTINATIONS_2025 = {
    ("FR", "paris"), ("ES", "madrid"), ("JP", "tokyo"),
    ("IT", "rome"), ("IT", "milan"), ("US", "new york"),
    ("NL", "amsterdam"), ("ES", "barcelona"), ("SG", "singapore"),
    ("KR", "seoul"),
}

OUTPUT_COLUMNS = (
    "rank", "priority_band", "screening_score_100", "evidence_grade",
    "city", "country", "country_code", "population_2025",
    "country_tourist_arrivals", "tourism_year", "city_arrivals_2025",
    "demand_basis", "homicides_per_100k",
    "homicide_year", "gpi_overall_2026", "gpi_safety_2026",
    "gpi_conflict_2026", "demand_score_40", "safety_score_35",
    "market_size_score_15", "city_evidence_score_10",
    "verified_arrivals_top10", "verified_destination_top10",
    "risk_review", "commercial_property_rent", "hotel_occupancy",
    "lodging_zoning", "evidence_gaps", "country_tourism_source",
    "country_crime_source", "gpi_source", "city_evidence_source",
)


def iso_lookup(path: Path) -> dict[str, str]:
    mapping = {"XK": "XKX"}
    with path.open(encoding="utf-8-sig") as stream:
        for line in stream:
            if line.startswith("#") or not line.strip():
                continue
            fields = line.rstrip("\r\n").split("\t")
            if len(fields) > 1:
                mapping[fields[0]] = fields[1]
    return mapping


def timeseries(path: Path, value_col: str, max_year: int = 2024) -> dict[str, tuple[float, int]]:
    entries: dict[str, tuple[float, int]] = {}
    with path.open(encoding="utf-8-sig", newline="") as stream:
        reader = csv.DictReader(stream)
        for record in reader:
            code = str(record.get("Code") or "").strip()
            if not (len(code) == 3 and code.isalpha()):
                continue
            try:
                year = int(record["Year"])
                val = float(record[value_col])
            except (KeyError, ValueError, TypeError):
                continue
            if 2019 <= year <= max_year and val >= 0:
                if code not in entries or year > entries[code][1]:
                    entries[code] = (val, year)
    return entries


def gpi_scores(path: Path) -> dict[str, dict]:
    with path.open(encoding="utf-8-sig", newline="") as stream:
        records = list(csv.DictReader(stream))
    if not records:
        raise ValueError("Empty GPI source")
    return {x["iso3"]: x for x in records}


def normalized_city(country: str, name: str) -> str:
    # City names sometimes contain official names plus common name in parentheses.
    value = unicodedata.normalize("NFKD", name).encode("ascii", "ignore").decode("ascii").lower()
    value = re.sub(r"[^a-z0-9]+", " ", value).strip()
    aliases = (
        ("TH", "bangkok", "bangkok"),
        ("TR", "istanbul", "istanbul"),
        ("TR", "antalya", "antalya"),
        ("MO", "macao", "macau"),
        ("MO", "macau", "macau"),
        ("SA", "makkah", "mecca"),
        ("SA", "mecca", "mecca"),
        ("JP", "tokyo", "tokyo"),
        ("IT", "roma", "rome"),
        ("IT", "milano", "milan"),
        ("US", "new york", "new york"),
        ("GB", "london", "london"),
        ("FR", "paris", "paris"),
        ("ES", "madrid", "madrid"),
        ("ES", "barcelona", "barcelona"),
        ("SG", "singapore", "singapore"),
        ("KR", "seoul", "seoul"),
        ("MY", "kuala lumpur", "kuala lumpur"),
        ("HK", "hong kong", "hong kong"),
        ("AE", "dubai", "dubai"),
        ("NL", "amsterdam", "amsterdam"),
    )
    for iso, search, canonical in aliases:
        if iso == country and search in value:
            return canonical
    return value.split(" (", 1)[0]


def clamp(x: float, low: float = 0.0, high: float = 1.0) -> float:
    return max(low, min(high, x))


def component_scores(
    population: int, tourist_arrivals: float | None,
    homicide: float | None, safety: float | None, key: tuple[str, str],
    city_arrivals: float | None = None
) -> tuple[float, float, float, int]:
    # Verified 2025 city visitors supersede older, country-wide totals.
    # The country-only proxy has a lower ceiling because it does not prove
    # which cities visitors actually went to.
    demand = (
        40 * clamp(math.log1p(city_arrivals / 1_000_000) / math.log1p(30.3))
        if city_arrivals is not None
        else 30 * clamp(math.log1p(tourist_arrivals / 1_000_000) / math.log1p(60))
        if tourist_arrivals is not None else 0.0
    )
    crime_score = 15 * math.exp(-min(homicide, 100) / 6) if homicide is not None else 0.0
    peace_score = 20 * clamp((3.6 - safety) / 2.4) if safety is not None else 0.0
    safety_total = crime_score + peace_score
    size = 15 * clamp(math.log(max(1, population) / 1_000_000) / math.log(40))
    city_bonus = (5 if key in TOP_ARRIVALS_2025 else 0) + (5 if key in TOP_DESTINATIONS_2025 else 0)
    return round(demand, 2), round(safety_total, 2), round(size, 2), city_bonus


def ranked_markets(
    catalog: Path, tourism: Path, homicide: Path, gpi: Path, iso: Path
) -> tuple[list[dict], dict]:
    iso_map = iso_lookup(iso)
    tourist = timeseries(tourism, "Arrivals of tourists from abroad")
    crime = timeseries(homicide, "Homicide rate per 100,000 population")
    peace = gpi_scores(gpi)
    data: list[dict] = []
    seen: set[tuple[str, str]] = set()
    with catalog.open(encoding="utf-8") as stream:
        for line in stream:
            if not line.strip():
                continue
            city = json.loads(line)
            code = str(city["country_code"]).upper()
            if code in EXCLUDED_COUNTRY_CODES:
                continue
            key = (code, str(city["city_code"]))
            if key in seen:
                continue
            seen.add(key)
            iso3 = iso_map.get(code)
            tourist_rec = tourist.get(iso3) if iso3 else None
            crime_rec = crime.get(iso3) if iso3 else None
            gpi_rec = peace.get(iso3) if iso3 else None
            p = int(city["population_2025"])
            if p <= 1_000_000:
                continue
            safety = float(gpi_rec["safety_security_score_2026"]) if gpi_rec else None
            total = float(gpi_rec["overall_score_2026"]) if gpi_rec else None
            conflict = float(gpi_rec["ongoing_conflict_score_2026"]) if gpi_rec else None
            tval = tourist_rec[0] if tourist_rec else None
            tyear = tourist_rec[1] if tourist_rec else None
            hval = crime_rec[0] if crime_rec else None
            hyear = crime_rec[1] if crime_rec else None
            city_key = (code, normalized_city(code, city["city"]))
            city_arrivals = CITY_ARRIVALS_2025.get(city_key)
            demand, safety_pts, market_size, city_evidence = component_scores(
                p, tval, hval, safety, city_key, city_arrivals
            )
            # Sources older than 2022 are not sufficiently current for final priority.
            gaps = []
            if tourist_rec is None:
                gaps.append("country tourism unavailable")
            elif tyear < 2022:
                gaps.append(f"country tourism stale ({tyear})")
            if crime_rec is None:
                gaps.append("country homicide unavailable")
            elif hyear < 2020:
                gaps.append(f"country homicide stale ({hyear})")
            if not gpi_rec:
                gaps.append("GPI country safety unavailable")
            if city_evidence == 0:
                gaps.append("city demand not independently quantified")
            gaps.extend(["city hotel occupancy unknown", "commercial rent unknown", "lodging zoning unknown"])
            recent_demand = bool(city_arrivals or (tourist_rec and tyear >= 2022))
            complete_country_evidence = bool(
                recent_demand and crime_rec and hyear >= 2020 and gpi_rec
            )
            risk_review = (
                "ELEVATED_COUNTRY_RISK_REVIEW"
                if gpi_rec and (total >= 2.7 or conflict >= 3.0)
                else "COUNTRY_RISK_DATA_MISSING"
                if not gpi_rec else "NO_AUTOMATIC_BLOCK"
            )
            grade = (
                "A-city-data" if complete_country_evidence and city_arrivals
                else "A-country-data" if complete_country_evidence
                else "B-incomplete" if sum([bool(city_arrivals or tourist_rec), bool(crime_rec), bool(gpi_rec)]) >= 2
                else "C-sparse"
            )
            score = round(demand + safety_pts + market_size + city_evidence, 2)
            tier = "NEEDS_DATA"
            if risk_review == "ELEVATED_COUNTRY_RISK_REVIEW":
                tier = "SAFETY_REVIEW"
            elif risk_review == "COUNTRY_RISK_DATA_MISSING":
                tier = "B-SAFETY_VERIFY" if city_arrivals else "NEEDS_DATA"
            elif city_arrivals and not (crime_rec and hyear >= 2020):
                tier = "B-SAFETY_VERIFY"
            elif complete_country_evidence:
                if score >= 70 and city_evidence >= 5:
                    tier = "A-PRIORITY"
                elif score >= 55 or city_arrivals:
                    tier = "B-SHORTLIST"
                else:
                    tier = "C-RESEARCH"
            elif city_arrivals:
                tier = "B-SHORTLIST"
            data.append({
                "rank": None, "priority_band": tier, "screening_score_100": score,
                "evidence_grade": grade,
                "city": city["city"], "country": city["country"], "country_code": code,
                "population_2025": p,
                "country_tourist_arrivals": round(tval) if tval is not None else None,
                "tourism_year": tyear, "city_arrivals_2025": city_arrivals,
                "demand_basis": "verified_2025_city" if city_arrivals else "country_proxy" if tourist_rec else "missing",
                "homicides_per_100k": round(hval, 2) if hval is not None else None,
                "homicide_year": hyear, "gpi_overall_2026": total,
                "gpi_safety_2026": safety, "gpi_conflict_2026": conflict,
                "demand_score_40": demand, "safety_score_35": safety_pts,
                "market_size_score_15": market_size, "city_evidence_score_10": city_evidence,
                "verified_arrivals_top10": city_key in TOP_ARRIVALS_2025,
                "verified_destination_top10": city_key in TOP_DESTINATIONS_2025,
                "risk_review": risk_review,
                "commercial_property_rent": None, "hotel_occupancy": None,
                "lodging_zoning": "NOT_REVIEWED",
                "evidence_gaps": "; ".join(gaps),
                "country_tourism_source": TOURISM_URL, "country_crime_source": HOMICIDE_URL,
                "gpi_source": GPI_URL, "city_evidence_source": CITY_EVIDENCE_URL,
            })
    # A country-score proxy alone does not establish city attractiveness. Give
    # corroborated, fully sourced city signals first in the research queue.
    tier_order = {"A-PRIORITY": 0, "B-SHORTLIST": 1, "B-SAFETY_VERIFY": 2,
                  "C-RESEARCH": 3, "SAFETY_REVIEW": 4, "NEEDS_DATA": 5}
    data.sort(key=lambda x: (
        tier_order[x["priority_band"]], -x["screening_score_100"],
        -x["city_evidence_score_10"], x["country"], x["city"]
    ))
    for number, row in enumerate(data, start=1):
        row["rank"] = number
    manifest = {
        "created_at": datetime.now(timezone.utc).isoformat(),
        "scope": "UN WUP 2025 worldwide urban areas >1,000,000; owner exclusions applied",
        "excluded_country_codes": sorted(EXCLUDED_COUNTRY_CODES),
        "cities": len(data),
        "source_urls": [TOURISM_URL, HOMICIDE_URL, GPI_URL, CITY_EVIDENCE_URL, GEONAMES_URL],
        "model_points": {
            "tourism_demand": 40, "country_safety": 35,
            "city_population": 15, "euromonitor_2025_top10_evidence": 10,
            "tourism_demand_method": "2025 city arrivals (max40) if available; otherwise country tourist-arrivals proxy (max30)",
        },
        "cautions": [
            "This score is research-priority, NOT projected ROI, actual city crime rate, affordability or safety certification.",
            "Homicide figures and most tourist arrivals describe countries, not cities. Confirmed 2025 city arrivals override stale country tourism for ten Euromonitor destinations.",
            "Missing inputs receive no points, NOT an imputed zero value; tiers flag incomplete data and require further research.",
            "Rental levels, hotel occupancy, property supply and legal permissions have NOT been researched; no property can be invested in from this file alone.",
            "High national risk triggers SAFETY_REVIEW (not a blanket country exclusion), including cities in Russia.",
            "The GPI has a broader definition of peace than crime. No source automatically characterises a city as safe.",
        ],
        "priority_counts": dict(sorted(Counter(row["priority_band"] for row in data).items())),
        "evidence_counts": dict(sorted(Counter(row["evidence_grade"] for row in data).items())),
        "city_top10_matches": sum(x["city_evidence_score_10"] > 0 for x in data),
        "city_arrivals_2025_coverage": sum(x["city_arrivals_2025"] is not None for x in data),
    }
    return data, manifest


def save_outputs(rows: list[dict], manifest: dict, output_dir: Path) -> None:
    output_dir.mkdir(parents=True, exist_ok=True)
    with (output_dir / "market-priority-2026.csv").open(
        "w", encoding="utf-8-sig", newline=""
    ) as file:
        writer = csv.DictWriter(file, fieldnames=OUTPUT_COLUMNS)
        writer.writeheader()
        writer.writerows(rows)
    (output_dir / "market-priority-2026.json").write_text(
        json.dumps(rows, ensure_ascii=False, indent=2) + "\n", encoding="utf-8"
    )
    (output_dir / "market-priority-2026.manifest.json").write_text(
        json.dumps(manifest, ensure_ascii=False, indent=2) + "\n", encoding="utf-8"
    )


def main(argv: list[str] | None = None) -> int:
    parser = argparse.ArgumentParser(description="Rank ASI Cabins worldwide property discovery markets")
    parser.add_argument("--city-catalog", type=Path, required=True)
    parser.add_argument("--tourism-csv", type=Path, required=True)
    parser.add_argument("--homicide-csv", type=Path, required=True)
    parser.add_argument("--gpi-csv", type=Path, required=True)
    parser.add_argument("--country-info", type=Path, required=True)
    parser.add_argument("--output", type=Path, required=True)
    args = parser.parse_args(argv)
    results, manifest = ranked_markets(
        args.city_catalog, args.tourism_csv, args.homicide_csv,
        args.gpi_csv, args.country_info
    )
    if not results:
        parser.error("No cities scored; inspect inputs")
    save_outputs(results, manifest, args.output)
    print("Rated", len(results), "global cities")
    print("Coverage", manifest["evidence_counts"])
    print("Bands", manifest["priority_counts"])
    for row in results[:25]:
        print(f"{row['rank']:>3} | {row['screening_score_100']:5.1f} | "
              f"{row['priority_band']:<14} | {row['city'][:24]:<24} | "
              f"{row['country'][:20]:<20} | "
              f"{row['country_tourist_arrivals']} tourist arrivals")
    return 0


if __name__ == "__main__":
    raise SystemExit(main())
