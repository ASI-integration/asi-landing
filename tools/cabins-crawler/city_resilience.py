#!/usr/bin/env python3
"""City resilience overlay for ASI Cabins (NOT the existing Evergreen Index).

Uses verifiable city-level hotel/visitor snapshots, preserves global screening
score and rank, and leaves property-level Evergreen/magnets unmeasured.
2 years are insufficient to establish long-run/seasonal stability.
No country is removed based on geopolitical country proxies alone.
"""
from __future__ import annotations

import argparse
import csv
from datetime import datetime, timezone
import json
from pathlib import Path

COLUMNS = (
    "global_screening_rank", "global_screening_score", "global_priority_band",
    "city", "country", "country_code", "population_2025",
    "city_visitors_2025", "city_visitors_change_pct",
    "domestic_share_2025_pct", "hotel_occupancy_2024_pct",
    "hotel_occupancy_2025_pct", "hotel_occupancy_change_pp",
    "hotel_adr_2025", "hotel_adr_currency", "city_stability_proxy_100",
    "stability_evidence_status", "seasonality_status", "evergreen_index",
    "magnet_score", "magnet_count", "site_location_status",
    "geo_risk_review", "commercial_rent", "hotel_conversion_permission",
    "profit_status", "benchmark_sources",
)


def clamp(value: float, a: float = 0.0, b: float = 1.0) -> float:
    return min(b, max(a, value))


def stability_snapshot(benchmark: dict) -> dict:
    """Calculate a transparent *two-year demand proxy*, not a true Evergreen.

    Occupancy level: 35; 2024->2025 occupancy persistence: 30;
    domestic visitor share: 25; 2024->2025 visitor growth: 10.
    These are research-design weights, not empirically estimated ROI factors.
    """
    occ = benchmark["hotel_occupancy_pct"]
    visitor = benchmark["city_visitors_millions"]
    pct_2024 = float(occ["2024"])
    pct_2025 = float(occ["2025"])
    t24 = float(visitor["2024"])
    t25 = float(visitor["2025"])
    domestic = float(benchmark["city_domestic_visitors_millions_2025"])
    if not (0 <= pct_2024 <= 100 and 0 <= pct_2025 <= 100):
        raise ValueError("Invalid hotel occupancy percentage")
    if not (t24 > 0 and t25 > 0 and 0 <= domestic <= t25):
        raise ValueError("Invalid tourist/visitor totals")
    delta = pct_2025 - pct_2024
    change = 100.0 * (t25 / t24 - 1.0)
    domestic_share = domestic / t25
    occupancy_component = 35 * clamp(pct_2025 / 85)
    yoy_consistency = 30 * clamp(1.0 - abs(delta) / 10)
    domestic_component = 25 * domestic_share
    tourism_growth_component = 10 * clamp((change + 5) / 10)
    score = round(
        occupancy_component + yoy_consistency + domestic_component
        + tourism_growth_component, 2
    )
    monthly = benchmark.get("seasonality_monthly_pct")
    seasonal_status = "MONTHLY_DATA_MISSING"
    if monthly is not None:
        if len(monthly) != 12 or any(not 0 <= float(n) <= 100 for n in monthly):
            raise ValueError("Seasonal occupancy must contain 12 valid monthly percentages")
        seasonal_status = "MONTHLY_DATA_PRESENT_REQUIRES_MULTIYEAR_VALIDATION"
    return {
        "city_visitors_2025": round(t25 * 1_000_000),
        "city_visitors_change_pct": round(change, 2),
        "domestic_share_2025_pct": round(domestic_share * 100, 2),
        "hotel_occupancy_2024_pct": pct_2024,
        "hotel_occupancy_2025_pct": pct_2025,
        "hotel_occupancy_change_pp": round(delta, 2),
        "hotel_adr_2025": benchmark["adr_2025"]["value"],
        "hotel_adr_currency": benchmark["adr_2025"]["currency"],
        "city_stability_proxy_100": score,
        "stability_evidence_status": "LIMITED_2024_2025_SNAPSHOT",
        "seasonality_status": seasonal_status,
        "benchmark_sources": " | ".join(x["url"] for x in benchmark["sources"]),
    }


def build_overlay(priority_csv: Path, city_benchmarks_json: Path) -> tuple[list[dict], dict]:
    benchmarks_document = json.loads(city_benchmarks_json.read_text(encoding="utf-8"))
    city_evidence: dict[tuple[str, str], dict] = {}
    for entry in benchmarks_document["cities"]:
        key = (str(entry["country_code"]), str(entry["city_code"]))
        if key in city_evidence:
            raise ValueError("Duplicate city benchmark " + str(key))
        if len(entry.get("sources", [])) < 2:
            raise ValueError("City evidence requires at least two source references")
        city_evidence[key] = entry
    rows: list[dict] = []
    seen_benchmarks = set()
    with priority_csv.open(encoding="utf-8-sig", newline="") as stream:
        for ranked in csv.DictReader(stream):
            code = ranked["country_code"]
            # Global rank CSV has city name; join to exact WUP code below using
            # the ISO2 + normalized city name from the source catalog only when
            # the benchmark supplies a city_code in the research CSV. If the
            # ranking has no city_code, populate from canonical city name.
            name = ranked["city"].lower()
            selected = [
                (key, obj) for key, obj in city_evidence.items()
                if key[0] == code and (
                    ("moscow" in name and obj["display_name"] == "Moscow")
                    or ("new york city" in name and obj["display_name"] == "New York City")
                )
            ]
            if len(selected) > 1:
                raise ValueError("Ambiguous city match")
            benchmark = selected[0][1] if selected else None
            if selected:
                seen_benchmarks.add(selected[0][0])
            stability = stability_snapshot(benchmark) if benchmark else {
                "city_visitors_2025": None, "city_visitors_change_pct": None,
                "domestic_share_2025_pct": None,
                "hotel_occupancy_2024_pct": None,
                "hotel_occupancy_2025_pct": None, "hotel_occupancy_change_pp": None,
                "hotel_adr_2025": None, "hotel_adr_currency": None,
                "city_stability_proxy_100": None,
                "stability_evidence_status": "MISSING_CITY_HOTEL_DATA",
                "seasonality_status": "MONTHLY_DATA_MISSING",
                "benchmark_sources": "",
            }
            rows.append({
                "global_screening_rank": int(ranked["rank"]),
                "global_screening_score": float(ranked["screening_score_100"]),
                "global_priority_band": ranked["priority_band"],
                "city": ranked["city"], "country": ranked["country"],
                "country_code": code,
                "population_2025": int(ranked["population_2025"]),
                **stability,
                "evergreen_index": None,
                "magnet_score": None,
                "magnet_count": None,
                "site_location_status": "SITE_COORDINATES_AND_ASI_REPORT_REQUIRED",
                "geo_risk_review": ranked["risk_review"],
                "commercial_rent": None,
                "hotel_conversion_permission": None,
                "profit_status": "UNVERIFIED_UNTIL_ACTUAL_PROPERTY_COSTS",
            })
    if len(seen_benchmarks) != len(city_evidence):
        raise ValueError("City benchmarks not matched: " + repr(set(city_evidence)-seen_benchmarks))
    return rows, {
        "generated_at": datetime.now(timezone.utc).isoformat(),
        "all_markets": len(rows), "city_stability_observed": len(seen_benchmarks),
        "evergreen_properties_measured": 0,
        "snapshot_years": [2024, 2025],
        "formula": {
            "2025_hotel_occupancy_component_max": 35,
            "hotel_occupancy_change_component_max": 30,
            "domestic_market_share_component_max": 25,
            "visitor_growth_component_max": 10,
        },
        "warnings": [
            "2-year proxy is not a long-run stability index or a verified booking forecast.",
            "Moscow NF Group hotel benchmark and NYC CoStar hospitality market use different populations and methodologies.",
            "Official ASI Evergreen Index and magnets require geocoded property address plus existing src/lib/location engine evidence; intentionally left null.",
            "The country geopolitics/risk flag is NOT a city street-crime metric.",
            "ADR in RUB vs USD must not be compared as profit and is not used in the stability score.",
            "City-specific stability benchmarks missing for all other markets; their value is null, not zero.",
        ]
    }


def export(rows: list[dict], manifest: dict, out: Path) -> None:
    out.mkdir(parents=True, exist_ok=True)
    with (out / "city-stability-overlay.csv").open("w", encoding="utf-8-sig", newline="") as stream:
        w = csv.DictWriter(stream, fieldnames=COLUMNS)
        w.writeheader()
        w.writerows(rows)
    (out / "city-stability-overlay.manifest.json").write_text(
        json.dumps(manifest, ensure_ascii=False, indent=2) + "\n", encoding="utf-8"
    )


def main(argv: list[str] | None = None) -> int:
    p = argparse.ArgumentParser(description="Optional 2025 city demand resilience overlay")
    p.add_argument("--ranking", type=Path, required=True)
    p.add_argument("--benchmarks", type=Path, required=True)
    p.add_argument("--output", type=Path, required=True)
    args = p.parse_args(argv)
    rows, manifest = build_overlay(args.ranking, args.benchmarks)
    export(rows, manifest, args.output)
    print("Worldwide markets", manifest["all_markets"])
    print("Verified (two-year only) city snapshots", manifest["city_stability_observed"])
    for row in rows:
        if row["city_stability_proxy_100"] is not None:
            print(
                row["city"], row["city_stability_proxy_100"],
                "occupancy 2025", row["hotel_occupancy_2025_pct"],
                "occupancy Δ", row["hotel_occupancy_change_pp"],
                "domestic visitors", row["domestic_share_2025_pct"],
                "profit", row["profit_status"]
            )
    return 0


if __name__ == "__main__":
    raise SystemExit(main())
