#!/usr/bin/env python3
"""One-command, resumable ASI Cabins property research campaign.

Only processes enabled, allowlisted, source-specific property search adapters.
Explicit --execute is required; otherwise prints readiness without network I/O.
No scheduler or background service is installed by this file.
"""
from __future__ import annotations

import argparse
from datetime import datetime, timezone
from hashlib import sha256
import json
from pathlib import Path

import crawler


def source_key(source: dict) -> str:
    stable = {
        "name": source["name"],
        "country_codes": source.get("country_codes", []),
        "search_url_template": source.get("search_url_template"),
    }
    return sha256(json.dumps(stable, sort_keys=True).encode("utf-8")).hexdigest()[:16]


def read_state(path: Path) -> dict:
    if not path.exists():
        return {"schema": "asi-cabins-campaign-v1", "sources": {}}
    data = json.loads(path.read_text(encoding="utf-8"))
    if data.get("schema") != "asi-cabins-campaign-v1" or not isinstance(data.get("sources"), dict):
        raise ValueError("Unknown campaign state schema; refusing to discard progress")
    return data


def save_state(path: Path, data: dict) -> None:
    path.parent.mkdir(parents=True, exist_ok=True)
    temp = path.with_suffix(".tmp")
    temp.write_text(json.dumps(data, ensure_ascii=False, indent=2) + "\n", encoding="utf-8")
    temp.replace(path)


def existing_leads(output: Path) -> dict[str, dict]:
    leads_path = output / "leads.json"
    if not leads_path.exists():
        return {}
    rows = json.loads(leads_path.read_text(encoding="utf-8"))
    if not isinstance(rows, list):
        raise ValueError("Existing lead store has invalid structure")
    return {str(row["id"]): row for row in rows}


def run_once(
    config: dict, catalog: Path, output: Path, batch: int,
    execute: bool, state_path: Path | None = None,
) -> dict:
    if not 1 <= batch <= 20:
        raise ValueError("Batch must be between 1 and 20")
    if not catalog.is_file():
        raise FileNotFoundError(f"City catalog not found: {catalog}")
    state_file = state_path or (output / "campaign-state.json")
    state = read_state(state_file)
    sources = [
        source for source in config["sources"]
        if source.get("enabled") and source.get("search_url_template") and source.get("country_codes")
    ]
    if not execute:
        return {
            "mode": "preview", "enabled_city_sources": len(sources),
            "state_file": str(state_file), "output": str(output),
            "processed": 0, "blocked": [],
        }
    if not sources:
        raise ValueError("No approved/enabled regional city source: activation refused")
    all_leads = existing_leads(output)
    errors: list[str] = []
    completed = 0
    blocked: list[str] = []
    agent = config.get("user_agent", "ASI-Cabins-Research/0.1")
    page_cap = max(1, min(int(config.get("max_pages_per_source", 15)), 50))
    delay = max(2.0, float(config.get("delay_seconds", 3)))
    now = datetime.now(timezone.utc).isoformat()
    for source in sources:
        key = source_key(source)
        entry = state["sources"].setdefault(
            key, {"name": source["name"], "offset": 0, "complete": False}
        )
        for _ in range(batch):
            urls, next_offset = crawler.city_seed_urls(
                source, catalog, int(entry["offset"]), batch=1
            )
            if not urls:
                entry["complete"] = True
                break
            entry["complete"] = False
            leads, problems = crawler.crawl_source(
                source, agent, page_cap, delay, now, seed_urls=urls
            )
            for item in leads:
                all_leads[str(item["id"])] = item
            if problems:
                errors.extend(problems)
                entry["blocked_at_offset"] = entry["offset"]
                entry["last_error"] = problems[:5]
                blocked.append(source["name"])
            else:
                entry["offset"] = next_offset
                entry.pop("blocked_at_offset", None)
                entry.pop("last_error", None)
                completed += 1
            # Keep research results before advancing the persisted cursor.
            crawler.export(list(all_leads.values()), errors, output)
            state["updated_at"] = datetime.now(timezone.utc).isoformat()
            save_state(state_file, state)
            if problems:
                # Do not silently skip a disallowed/broken listing site.
                break
    return {
        "mode": "executed", "enabled_city_sources": len(sources),
        "processed": completed, "blocked": blocked, "leads_total": len(all_leads),
        "state_file": str(state_file), "output": str(output),
        "source_offsets": {entry["name"]: entry["offset"] for entry in state["sources"].values()},
    }


def main(argv: list[str] | None = None) -> int:
    parser = argparse.ArgumentParser(description="ASI Cabins resumable city-to-property crawl")
    parser.add_argument("--config", type=Path, default=crawler.DEFAULT_CONFIG)
    parser.add_argument("--city-catalog", type=Path, required=True)
    parser.add_argument("--output", type=Path, default=Path("cabins-crawler-output"))
    parser.add_argument("--batch", type=int, default=3, help="Cities per enabled source per run (1..20)")
    parser.add_argument("--execute", action="store_true", help="Activate approved public property site fetching")
    args = parser.parse_args(argv)
    config = crawler.load_config(args.config)
    result = run_once(config, args.city_catalog, args.output, args.batch, args.execute)
    print(json.dumps(result, indent=2, ensure_ascii=False))
    if result["mode"] == "executed" and result["blocked"]:
        return 3
    return 0


if __name__ == "__main__":
    raise SystemExit(main())
