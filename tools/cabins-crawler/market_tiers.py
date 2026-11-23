#!/usr/bin/env python3
"""Three-stage research queue for ASI Cabins: market -> investment -> site.

Tier 1 means strong evidence of DEMAND and an initial acceptable country risk
screen, NOT verified profitability or Evergreen. Do not fabricate rent, lender
offers, agent interest, magnet score, occupancy or financial return.

Only direct documented benchmark values from city_resilience.py may be read as
city-level hotel-demand evidence. Official ASI Evergreen is an address-level
field, populated later from verified evergreen_bridge.py outputs.
"""
from __future__ import annotations

import argparse
from collections import Counter
import csv
from datetime import datetime, timezone
import json
from pathlib import Path

from scope import EXCLUDED_COUNTRY_CODES

TIERS = ("I-HIGH", "II-MEDIUM", "III-RESERVE")
LEVELS = ("HIGH", "MEDIUM", "LOW", "UNKNOWN")
COLUMNS = (
    "research_order", "research_tier", "city", "country", "country_code",
    "population_2025", "population_band", "demand_band",
    "demand_basis", "city_arrivals_2025", "city_visitors_2025",
    "tourism_country_arrivals", "global_score", "global_rank",
    "global_priority_band", "city_stability_score_100", "stability_band",
    "stability_evidence_status", "risk_gate", "market_access_gate",
    "profitability_band", "rent_per_sqm", "expected_net_margin",
    "evergreen_band", "asi_evergreen_index", "asi_magnet_score",
    "seasonality_verified", "legal_conversion_status",
    "financing_program_status", "financing_research_priority",
    "local_partner_interest_status", "partner_research_priority",
    "tier_reason", "next_gate",
)

def optional_float(v: object) -> float | None:
    if v is None or str(v).strip() == "":
        return None
    try:
        x = float(v)
    except (ValueError, TypeError):
        raise ValueError("Invalid numeric source: " + str(v))
    if not -1e100 < x < 1e100:
        raise ValueError("Invalid nonfinite source number")
    return x


def load_csv(path: Path) -> list[dict]:
    with path.open(encoding="utf-8-sig", newline="") as file:
        return list(csv.DictReader(file))


def _name_key(row: dict) -> tuple[str, str]:
    """Exact WUP name and ISO2, no fuzzy name matching or accidental duplicates."""
    return str(row["country_code"]).upper(), str(row["city"])


def bands(global_row: dict, stability_row: dict | None = None) -> dict:
    """A transparent research ranking with financing/profit hard-gates.

    City population is only a market-size signal, not evidence of visitors.
    No high-demand claim from country data alone without corroboration.
    """
    code = str(global_row["country_code"]).upper()
    if code in EXCLUDED_COUNTRY_CODES:
        raise ValueError("Owner-excluded country in ranking: " + code)
    pop = int(global_row["population_2025"])
    if pop <= 1_000_000:
        raise ValueError("Not an eligible million-plus urban area")
    pop_band = "HIGH" if pop >= 5_000_000 else "MEDIUM" if pop >= 2_000_000 else "LOW"
    base = float(global_row["screening_score_100"])
    demand_points = float(global_row["demand_score_40"])
    verified_city_arrivals = optional_float(global_row.get("city_arrivals_2025"))
    city_visitor_count = optional_float((stability_row or {}).get("city_visitors_2025"))
    city_stability = optional_float((stability_row or {}).get("city_stability_proxy_100"))
    signal = float(global_row["city_evidence_score_10"])
    has_city_signal = signal > 0
    has_city_visitors = (verified_city_arrivals is not None or city_visitor_count is not None)
    has_strong_city_visitors = (
        (verified_city_arrivals is not None and verified_city_arrivals >= 10_000_000)
        or (city_visitor_count is not None and city_visitor_count >= 10_000_000)
    )
    country_data = str(global_row["evidence_grade"])
    country_risk = str(global_row["risk_review"])
    # Official Saudi 2026 law imposes special ownership/real-estate rights
    # rules in Makkah and Madinah for foreign investors. This flag requires
    # an operator-specific legal assessment (ownership vs lease vs partnership).
    # Source: https://rega.gov.sa/en/laws-and-decisions/regulations-and-by-laws/rules/law-of-real-estate-ownership-and-investment-by-non-saudis/
    name = str(global_row["city"]).lower()
    special_saudi_holy_city = (
        code == "SA" and any(term in name for term in
                           ("mecca", "makkah", "makkah", "madinah", "medina", "medinah"))
    )
    market_access_gate = (
        "SPECIAL_EXTERNAL_INVESTOR_RULES_VERIFY"
        if special_saudi_holy_city else "LOCAL_ENTRY_RULES_NOT_YET_REVIEWED"
    )
    safety_complete = (
        country_risk == "NO_AUTOMATIC_BLOCK"
        and str(global_row.get("homicides_per_100k") or "").strip() != ""
        and str(global_row.get("gpi_safety_2026") or "").strip() != ""
    )
    if country_risk == "ELEVATED_COUNTRY_RISK_REVIEW":
        risk_gate = "COUNTRY_RISK_REVIEW"
    elif not safety_complete:
        risk_gate = "COUNTRY_SAFETY_EVIDENCE_REVIEW"
    else:
        risk_gate = "BASIC_COUNTRY_CHECK_PASS"
    if has_strong_city_visitors or (has_city_signal and demand_points >= 24):
        demand_band = "HIGH"
    elif has_city_signal or demand_points >= 18 or has_city_visitors:
        demand_band = "MEDIUM"
    elif str(global_row.get("demand_basis")) == "missing":
        demand_band = "UNKNOWN"
    else:
        demand_band = "LOW"

    if city_stability is None:
        stability_band = "UNKNOWN"
    else:
        stability_band = ("HIGH" if city_stability >= 85 else
                          "MEDIUM" if city_stability >= 70 else "LOW")

    # I: meaningful city evidence, high demand and no country-risk flag.
    # Strong verified hotel data is an alternative to top-ten tourist rankings.
    tier_one = (
        not special_saudi_holy_city
        and safety_complete
        and demand_band == "HIGH"
        and (
            (has_city_signal and base >= 62 and
             (country_data.startswith("A") or verified_city_arrivals is not None))
            or (city_stability is not None and city_stability >= 85 and
                has_strong_city_visitors and base >= 55)
        )
    )
    # II: plausible medium or high demand; may have safety evidence gaps.
    # Country-risk flags stay explicit and are never cleared by occupancy.
    # Domestic-demand resilient city (e.g. Moscow) may receive research
    # attention but is NOT approved for investment or agent outreach.
    strong_local_evidence = (
        city_stability is not None and city_stability >= 75
        and city_visitor_count is not None and city_visitor_count >= 10_000_000
    )
    tier_two = (
        demand_band in {"HIGH", "MEDIUM"}
        and (
            base >= 47 or has_city_signal
            or strong_local_evidence
        )
        and (
            country_risk != "ELEVATED_COUNTRY_RISK_REVIEW"
            or strong_local_evidence
        )
    )
    if tier_one:
        tier = "I-HIGH"
        reason = "Corroborated city demand and preliminary country safety evidence"
    elif tier_two:
        tier = "II-MEDIUM"
        reason = (
            "City demand observed but country risk requires manual review"
            if risk_gate == "COUNTRY_RISK_REVIEW"
            else "Promising market; city demand, safety, or site economics need validation"
        )
    else:
        tier = "III-RESERVE"
        reason = (
            "Country risk elevated; no sufficient verified city resilience"
            if risk_gate == "COUNTRY_RISK_REVIEW"
            else "Market evidence or initial opportunity signals insufficient"
        )
    # Research priority is not confirmation that financing or agents exist.
    financing_priority = (
        "CHECK_FOREIGN_INVESTOR_ELIGIBILITY_FIRST" if special_saudi_holy_city else
        "RESEARCH_FIRST" if tier == "I-HIGH" else
        "RESEARCH_CONDITIONAL" if tier == "II-MEDIUM" else "DEFER"
    )
    partner_priority = (
        "CHECK_LOCAL_PARTNERSHIP_RULES_FIRST" if special_saudi_holy_city else
        "DISCOVER_FIRST" if tier == "I-HIGH" else
        "DISCOVER_CONDITIONAL" if tier == "II-MEDIUM" else "DEFER"
    )
    # Risks block contracting / outreach independently of market ranking.
    next_gate = (
        "LOCAL_FOREIGN_OWNERSHIP_AND_HOTEL_OPERATOR_ELIGIBILITY" if special_saudi_holy_city else
        "COUNTRY_AND_CITY_RISK_CLEARANCE" if risk_gate != "BASIC_COUNTRY_CHECK_PASS"
        else "CONFIRM_COMMERCIAL_SITE_RENT_ZONING_AND_MICROCABIN_UNIT_ECONOMICS"
    )
    return {
        "research_tier": tier,
        "population_band": pop_band,
        "demand_band": demand_band,
        "stability_band": stability_band,
        "risk_gate": risk_gate, "market_access_gate": market_access_gate,
        "profitability_band": "UNVERIFIED_NO_SITE_COSTS",
        "evergreen_band": "UNVERIFIED_NO_ASI_SITE_REPORT",
        "financing_research_priority": financing_priority,
        "partner_research_priority": partner_priority,
        "tier_reason": reason, "next_gate": next_gate,
        "_score": base, "_stability": city_stability,
    }


def group_markets(global_rows: list[dict], stability_rows: list[dict]) -> tuple[list[dict], dict]:
    stability_by_key: dict[tuple[str, str], dict] = {}
    for row in stability_rows:
        key = _name_key(row)
        if key in stability_by_key:
            raise ValueError("Duplicate stability key")
        stability_by_key[key] = row
    data: list[dict] = []
    seen = set()
    for r in global_rows:
        key = _name_key(r)
        if key in seen:
            raise ValueError("Duplicate city/country in global rank")
        seen.add(key)
        overlay = stability_by_key.get(key)
        tier = bands(r, overlay)
        record = {
            "research_order": 0,
            "research_tier": tier["research_tier"],
            "city": r["city"], "country": r["country"], "country_code": r["country_code"],
            "population_2025": int(r["population_2025"]),
            "population_band": tier["population_band"],
            "demand_band": tier["demand_band"],
            "demand_basis": r["demand_basis"],
            "city_arrivals_2025": optional_float(r.get("city_arrivals_2025")),
            "city_visitors_2025": optional_float((overlay or {}).get("city_visitors_2025")),
            "tourism_country_arrivals": optional_float(r.get("country_tourist_arrivals")),
            "global_score": float(r["screening_score_100"]),
            "global_rank": int(r["rank"]),
            "global_priority_band": r["priority_band"],
            "city_stability_score_100": tier["_stability"],
            "stability_band": tier["stability_band"],
            "stability_evidence_status": (
                (overlay or {}).get("stability_evidence_status") or "MISSING_CITY_HOTEL_DATA"
            ),
            "risk_gate": tier["risk_gate"],
            "market_access_gate": tier["market_access_gate"],
            "profitability_band": tier["profitability_band"],
            "rent_per_sqm": None,
            "expected_net_margin": None,
            "evergreen_band": tier["evergreen_band"],
            "asi_evergreen_index": None,
            "asi_magnet_score": None,
            "seasonality_verified": False,
            "legal_conversion_status": "NOT_REVIEWED",
            "financing_program_status": "NOT_RESEARCHED",
            "financing_research_priority": tier["financing_research_priority"],
            "local_partner_interest_status": "NOT_VERIFIED",
            "partner_research_priority": tier["partner_research_priority"],
            "tier_reason": tier["tier_reason"], "next_gate": tier["next_gate"],
        }
        data.append(record)
    order = {t: i for i, t in enumerate(TIERS)}
    data.sort(key=lambda r: (order[r["research_tier"]], -r["global_score"],
                             -float(r["city_stability_score_100"] or 0),
                             r["country"], r["city"]))
    for i, r in enumerate(data, 1):
        r["research_order"] = i
    totals = dict(sorted(Counter(r["research_tier"] for r in data).items()))
    manifest = {
        "generated_at": datetime.now(timezone.utc).isoformat(),
        "global_cities": len(data),
        "tiers": totals,
        "tier_order": list(TIERS),
        "thresholds": {
            "urban_population": "strictly above 1m",
            "population_bands": {"HIGH": ">=5m", "MEDIUM": "2m-5m", "LOW": ">1m-2m"},
            "demand_bands": "verified city visitors, city destination evidence or country proxy: see market_tiers.py bands()",
            "tier_I": "HIGH city demand + direct corroboration + adequate country safety evidence; NOT site ROI",
            "tier_II": "Promising but weaker/partial evidence, or strongly verified domestic demand subject to country risk review",
            "tier_III": "Low evidence, low demand proxy, or elevated country risk without separate city validation",
        },
        "review_status": {
            "site_evergreen_verified": 0, "profitability_verified": 0,
            "financing_programs_verified": 0, "interested_local_agents_verified": 0,
            "note": "These quantities describe currently available inputs, not absence of actual opportunities.",
        },
        "data_sources": [
            "market-priority-2026.csv (UN WUP 2025 / UN Tourism / UNODC / IEP GPI 2026 / Euromonitor 2025)",
            "city-stability-overlay.csv (2024-2025 verifiable city hotel snapshots for Moscow and New York)",
            "ASI canonical src/lib/location modules required later for true property-level Evergreen",
        ],
        "limitations": [
            "Ranking is for prioritising research, not comparative profitability or projected contract value.",
            "Finance-program eligibility and agent willingness are NOT implied by tourism/population; separately verify availability, jurisdiction, legal entity, credit, collateral, partner requirements.",
            "Makkah and Madinah have special foreign real-estate rules: https://rega.gov.sa/en/laws-and-decisions/regulations-and-by-laws/rules/law-of-real-estate-ownership-and-investment-by-non-saudis/ . Stage at Tier II pending legal review, not a prohibition.",
            "Site Evergreen and magnets require an exact location plus valid existing ASI engine analysis; city aggregates cannot replace it.",
            "Russia remains eligible for research; country risk flag is retained even when Moscow has city-level domestic-demand evidence.",
            "Low tier means limited information or weaker preliminary signals, not a blanket judgment about a location or population.",
        ],
    }
    return data, manifest


def write_tiers(data: list[dict], manifest: dict, directory: Path) -> None:
    directory.mkdir(parents=True, exist_ok=True)
    with (directory / "market-tiers-2026.csv").open("w", encoding="utf-8-sig", newline="") as stream:
        writer = csv.DictWriter(stream, fieldnames=COLUMNS)
        writer.writeheader()
        writer.writerows(data)
    for tier in TIERS:
        with (directory / f"city-catalog-{tier.lower()}.jsonl").open("w", encoding="utf-8") as out:
            for r in data:
                if r["research_tier"] != tier:
                    continue
                # Compatible with existing crawler.city_seed_urls; city name
                # is not the GeoNames ID. Do not invent population/evergreen.
                place = {
                    "city": r["city"], "country": r["country"],
                    "country_code": r["country_code"],
                    "research_tier": tier,
                    "global_score": r["global_score"],
                    "population_2025": r["population_2025"],
                    "risk_gate": r["risk_gate"],
                }
                out.write(json.dumps(place, ensure_ascii=False) + "\n")
    (directory / "market-tiers-2026.manifest.json").write_text(
        json.dumps(manifest, ensure_ascii=False, indent=2) + "\n", encoding="utf-8"
    )


def main(argv: list[str] | None = None) -> int:
    parser = argparse.ArgumentParser(description="Divide global ASI Cabins market research into 3 evidence-aware groups")
    parser.add_argument("--ranking", type=Path, required=True)
    parser.add_argument("--stability", type=Path, required=True)
    parser.add_argument("--output", type=Path, required=True)
    args = parser.parse_args(argv)
    data, manifest = group_markets(load_csv(args.ranking), load_csv(args.stability))
    if not data:
        parser.error("Missing city market ranking")
    write_tiers(data, manifest, args.output)
    print("Total", len(data), "Tier sizes:", manifest["tiers"])
    print("Tier I:")
    for r in (r for r in data if r["research_tier"] == "I-HIGH"):
        print(" ", r["research_order"], r["city"], r["country"], r["demand_band"], r["population_band"], r["global_score"])
    for p in ("RU", "US", "JP", "TW", "KR"):
        matching = [r for r in data if r["country_code"] == p]
        print(p, [(r["city"], r["research_tier"]) for r in matching[:8]])
    return 0


if __name__ == "__main__":
    raise SystemExit(main())
