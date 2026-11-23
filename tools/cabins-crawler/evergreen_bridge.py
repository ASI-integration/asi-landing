#!/usr/bin/env python3
"""Read-only bridge to the EXISTING ASI location Evergreen/magnets engine.

This module does NOT reproduce or alter src/lib/location/gravity-scoring.ts,
config.ts, location-score.ts, existing scoring weights or production services.
It accepts verified output of the original location analysis for a SPECIFIC
property coordinate and carries its published scores into Cabins research.
Nothing is inferred for a whole city from one property.
"""
from __future__ import annotations

import argparse
import json
import math
from pathlib import Path

ENGINE_FILES = [
    "src/lib/location/config.ts",
    "src/lib/location/gravity-scoring.ts",
    "src/lib/location/location-score.ts",
    "src/lib/location/location-scoring-rules.ts",
]

# Only map actual ASI engine category labels; weights come from output, not us.
MAGNET_CATEGORY_NAMES_RU = {
    "metro": "Метро",
    "airport": "Аэропорт",
    "attraction": "Достопримечательность",
    "hospital": "Медицинский кластер",
    "specializedMedicalAnchor": "Крупный медицинский центр",
    "university": "Университет",
    "convention": "Выставочный / конгресс-центр",
    "major_hotel": "Крупный отель",
    "business": "Деловой объект",
    "railway_station": "Вокзал",
    "strategicTransportHub": "Стратегический транспортный узел",
    "shopping_major": "Крупный торговый центр",
    "entertainment": "Развлекательный объект",
    "stadium": "Стадион / арена",
    "food": "Кафе или ресторан (слабый локальный сигнал)",
    "shopping_local": "Супермаркет (слабый локальный сигнал)",
}


def score(value: object, name: str) -> float:
    if isinstance(value, bool) or not isinstance(value, (int, float)):
        raise ValueError(f"Missing/unverified numeric {name}")
    v = float(value)
    if not math.isfinite(v) or not 0 <= v <= 100:
        raise ValueError(f"Invalid {name} (0..100 expected)")
    return round(v, 2)


def location_record(document: dict) -> dict:
    if not isinstance(document, dict):
        raise ValueError("Location evidence must be an object")
    location_id = document.get("location_id")
    if not isinstance(location_id, str) or not location_id.strip():
        raise ValueError("Location evidence requires location_id")
    if not (document.get("country_code") and document.get("city_code")):
        raise ValueError("Location evidence requires country_code and city_code")
    try:
        lat = float(document["latitude"])
        lon = float(document["longitude"])
    except (ValueError, KeyError, TypeError):
        raise ValueError("Location must have verified coordinates")
    if not (math.isfinite(lat) and math.isfinite(lon) and -90 <= lat <= 90 and -180 <= lon <= 180):
        raise ValueError("Invalid site coordinates")
    analysis = document.get("analysis") or {}
    integrity = analysis.get("analysisIntegrity") or {}
    metrics = analysis.get("locationScore") or {}
    breakdown = metrics.get("breakdown") or {}
    magnets = analysis.get("magnets")
    basic = {
        "location_id": location_id,
        "country_code": str(document["country_code"]),
        "city_code": str(document["city_code"]),
        "latitude": lat,
        "longitude": lon,
        "source_engine": "ASI-integration/asi-landing src/lib/location",
        "engine_files": ENGINE_FILES,
        "evergreen_index": None,
        "magnet_score": None,
        "location_score": None,
        "demand_score": None,
        "seasonality_score": None,
        "top_magnets": [],
        "magnet_count": None,
        "computation": "COPY_FROM_EXISTING_ASI_LOCATION_ENGINE_NOT_RECOMPUTED",
    }
    # Missing integrity metadata also fails closed; never infer that zero
    # magnets or a missing provider represents an unfavourable location.
    if not integrity or integrity.get("analysisIncomplete") is not False or integrity.get("scoreBlockedDueToIncompleteData") is not False:
        return {**basic, "status": "BLOCKED_OR_UNVERIFIED_ENGINE_EVIDENCE"}
    if not isinstance(magnets, list):
        return {**basic, "status": "MISSING_MAGNET_EVIDENCE"}
    if not isinstance(metrics, dict) or not isinstance(breakdown, dict):
        return {**basic, "status": "MISSING_SCORING_BREAKDOWN"}
    values = {}
    for k, v in {
        "evergreen_index": analysis.get("evergreenIndex"),
        "magnet_score": breakdown.get("magnet_score"),
        "location_score": metrics.get("location_score"),
        "demand_score": breakdown.get("demand_score"),
        "seasonality_score": breakdown.get("seasonality_score"),
    }.items():
        try:
            values[k] = score(v, k)
        except ValueError:
            return {**basic, "status": f"MISSING_OR_INVALID_{k.upper()}"}
    if abs(values["demand_score"] - (0.6 * values["evergreen_index"] + 0.4 * values["magnet_score"])) > 2:
        return {**basic, "status": "CORE_SCORE_CONSISTENCY_CHECK_FAILED"}
    mapped = []
    for m in magnets:
        if not isinstance(m, dict):
            return {**basic, "status": "INVALID_MAGNET_EVIDENCE"}
        cat = str(m.get("categoryId") or "")
        try:
            distance = float(m["distance"])
            raw = float(m["attractionScore"])
            weight = float(m["weight"])
        except (ValueError, KeyError, TypeError):
            return {**basic, "status": "INVALID_MAGNET_EVIDENCE"}
        if not all(math.isfinite(v) and v >= 0 for v in (distance, raw, weight)):
            return {**basic, "status": "INVALID_MAGNET_EVIDENCE"}
        mapped.append({
            "category": cat, "category_ru": MAGNET_CATEGORY_NAMES_RU.get(cat, cat),
            "name": str(m.get("name") or ""),
            "distance_m": round(distance, 1),
            "weight_from_ASI": weight,
            "attraction_score_from_ASI": round(raw, 3),
            "permanence_type": m.get("permanenceType"),
        })
    mapped.sort(key=lambda x: (-x["attraction_score_from_ASI"], x["distance_m"]))
    return {**basic, **values, "top_magnets": mapped[:12],
            "magnet_count": len(mapped), "status": "VERIFIED_ASI_SITE_EVIDENCE"}


def process_file(path: Path) -> list[dict]:
    output = []
    ids = set()
    with path.open(encoding="utf-8") as stream:
        for line in stream:
            if not line.strip():
                continue
            doc = json.loads(line)
            result = location_record(doc)
            if result["location_id"] in ids:
                raise ValueError("Duplicate location_id")
            ids.add(result["location_id"])
            output.append(result)
    return output


def main(argv: list[str] | None = None) -> int:
    parser = argparse.ArgumentParser(description="Import official ASI Evergreen and magnets from geocoded site analyses")
    parser.add_argument("--asi-reports", type=Path, required=True)
    parser.add_argument("--output", type=Path, required=True)
    args = parser.parse_args(argv)
    records = process_file(args.asi_reports)
    args.output.parent.mkdir(parents=True, exist_ok=True)
    args.output.write_text(
        json.dumps(records, ensure_ascii=False, indent=2) + "\n", encoding="utf-8"
    )
    print("Geocoded ASI locations:", len(records))
    print("Site Evergreen scores accepted:",
          sum(r["status"] == "VERIFIED_ASI_SITE_EVIDENCE" for r in records))
    return 0


if __name__ == "__main__":
    raise SystemExit(main())
