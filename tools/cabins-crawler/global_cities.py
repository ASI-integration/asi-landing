#!/usr/bin/env python3
"""World city catalog: UN World Urbanization Prospects 2025, cities >1m.

Uses only the Python standard library. Reads the UN's publicly downloaded XLSX
directly, without pandas/openpyxl, and keeps 2025 DEGURBA urban-area estimates
separate from administrative municipal populations.

Official source:
https://population.un.org/wup/downloads?tab=Cities
WUP2025-F21-DEGURBA-Cities_Pop.xlsx

No property sites, credentials, owner outreach or production services are used.
"""
from __future__ import annotations

import argparse
from collections import Counter
import csv
from datetime import datetime, timezone
from hashlib import sha256
import json
from pathlib import Path
import tempfile
from xml.etree import ElementTree as ET
import zipfile

from scope import EXCLUDED_COUNTRY_CODES, MIN_POPULATION, SOURCE_YEAR

UN_FILENAME = "WUP2025-F21-DEGURBA-Cities_Pop.xlsx"
UN_DOWNLOAD = "https://population.un.org/wup/assets/Download/Cities/" + UN_FILENAME
UN_ATTRIBUTION = "United Nations, DESA Population Division, World Urbanization Prospects: 2025 Revision, File F21 (DEGURBA)"
NAMESPACE = "{http://schemas.openxmlformats.org/spreadsheetml/2006/main}"
WORKSHEET = "xl/worksheets/sheet2.xml"
SHARED_STRINGS = "xl/sharedStrings.xml"
YEAR_COLUMN = "BJ"  # L = 1975, BJ = 2025; verified again against row 1.
HEADER_COLUMNS = {"B": "Location", "F": "ISO2_Code", "G": "City_Code",
                  "H": "City_Name", "J": "PWCent_Longitude", "K": "PWCent_Latitude"}
OUTPUT_COLUMNS = ("country_code", "country", "city", "population_2025", "city_code",
                  "latitude", "longitude", "year", "population_definition", "source")
MAX_UNCOMPRESSED_XML = 150_000_000
EXTRA_LABELS = {"TW": "Taiwan", "RU": "Russia", "KR": "South Korea"}


def col_from_ref(ref: str) -> str:
    return "".join(ch for ch in ref if ch.isalpha())


def read_shared_strings(archive: zipfile.ZipFile) -> list[str]:
    if archive.getinfo(SHARED_STRINGS).file_size > MAX_UNCOMPRESSED_XML:
        raise ValueError("Unexpected shared strings size")
    strings = []
    with archive.open(SHARED_STRINGS) as stream:
        for _, element in ET.iterparse(stream, events=("end",)):
            if element.tag == NAMESPACE + "si":
                # Concatenate text runs without losing styled fragments.
                value = "".join((node.text or "") for node in element.iter()
                                if node.tag == NAMESPACE + "t")
                strings.append(value)
                element.clear()
    return strings


def row_cells(element: ET.Element, shared: list[str], want: set[str]) -> dict[str, str]:
    cells: dict[str, str] = {}
    for cell in element.iter(NAMESPACE + "c"):
        col = col_from_ref(cell.get("r", ""))
        if col not in want:
            continue
        value = cell.find(NAMESPACE + "v")
        if value is None or value.text is None:
            inline = cell.find(NAMESPACE + "is")
            if inline is None:
                continue
            raw = "".join((node.text or "") for node in inline.iter()
                          if node.tag == NAMESPACE + "t")
        else:
            raw = value.text
            if cell.get("t") == "s":
                raw = shared[int(raw)]
        cells[col] = raw
    return cells


def load_global_cities(path: Path) -> tuple[list[dict], dict]:
    if not path.is_file():
        raise FileNotFoundError(path)
    stats = Counter()
    excluded = Counter()
    accepted = []
    seen = set()
    with zipfile.ZipFile(path) as archive:
        if archive.getinfo(WORKSHEET).file_size > MAX_UNCOMPRESSED_XML:
            raise ValueError("Unexpected WUP worksheet size")
        strings = read_shared_strings(archive)
        with archive.open(WORKSHEET) as stream:
            for _, element in ET.iterparse(stream, events=("end",)):
                if element.tag != NAMESPACE + "row":
                    continue
                fields = row_cells(element, strings, set(HEADER_COLUMNS) | {YEAR_COLUMN})
                if element.get("r") == "1":
                    for column, expected in HEADER_COLUMNS.items():
                        if fields.get(column) != expected:
                            raise ValueError(f"WUP unexpected {column} header: {fields.get(column)}")
                    if fields.get(YEAR_COLUMN) != str(SOURCE_YEAR):
                        raise ValueError("Unexpected WUP year column")
                    element.clear()
                    continue
                element.clear()
                code = fields.get("F", "").strip().upper()
                if not code or not fields.get(YEAR_COLUMN):
                    continue
                try:
                    population = float(fields[YEAR_COLUMN]) * 1000
                    city_code = str(fields["G"]).strip()
                    latitude = float(fields["K"])
                    longitude = float(fields["J"])
                except (ValueError, KeyError):
                    continue
                if population <= MIN_POPULATION or not (-90 <= latitude <= 90 and -180 <= longitude <= 180):
                    continue
                if code in EXCLUDED_COUNTRY_CODES:
                    excluded[code] += 1
                    continue
                key = (code, city_code)
                if key in seen:
                    continue
                seen.add(key)
                accepted.append({
                    "country_code": code,
                    "country": EXTRA_LABELS.get(code, fields.get("B", "").strip()),
                    "city": fields.get("H", "").strip(),
                    "population_2025": round(population),
                    "city_code": city_code,
                    "latitude": latitude,
                    "longitude": longitude,
                    "year": SOURCE_YEAR,
                    "population_definition": "UN DEGURBA continuous urban centre; not municipal jurisdiction",
                    "source": UN_ATTRIBUTION,
                })
                stats[code] += 1
    accepted.sort(key=lambda x: (x["country"], -x["population_2025"], x["city"]))
    source_hash = sha256()
    with path.open("rb") as stream:
        for chunk in iter(lambda: stream.read(1024 * 1024), b""):
            source_hash.update(chunk)
    manifest = {
        "generated_at": datetime.now(timezone.utc).isoformat(),
        "source_url": UN_DOWNLOAD,
        "source_file": path.name,
        "source_sha256": source_hash.hexdigest(),
        "source_citation": UN_ATTRIBUTION,
        "year": SOURCE_YEAR,
        "threshold": "strictly_more_than_1_000_000",
        "excluded_country_codes": sorted(EXCLUDED_COUNTRY_CODES),
        "excluded_urban_areas_by_country": dict(sorted(excluded.items())),
        "eligible_urban_areas_by_country": dict(sorted(stats.items())),
        "eligible_urban_areas_total": len(accepted),
        "definition": "UN DEGURBA 2025; contiguous high-density urban centre, not city-proper population",
        "qualification": "Country exclusions reflect explicit owner choices, not an objective universal safety rating.",
    }
    return accepted, manifest


def write_catalog(cities: list[dict], manifest: dict, output: Path) -> None:
    output.parent.mkdir(parents=True, exist_ok=True)
    # Write atomic local outputs; never overwrite the old GeoNames city catalog.
    with tempfile.NamedTemporaryFile(
        mode="w", encoding="utf-8", dir=output.parent,
        prefix=".wup-global-", suffix=".tmp", delete=False
    ) as tmp:
        temp_path = Path(tmp.name)
        for record in cities:
            tmp.write(json.dumps(record, ensure_ascii=False) + "\n")
    temp_path.replace(output)

    csv_path = output.with_suffix(".csv")
    with csv_path.open("w", encoding="utf-8-sig", newline="") as fh:
        writer = csv.DictWriter(fh, fieldnames=OUTPUT_COLUMNS)
        writer.writeheader()
        writer.writerows(cities)

    manifest_path = output.with_suffix(".manifest.json")
    manifest_path.write_text(json.dumps(manifest, ensure_ascii=False, indent=2) + "\n", encoding="utf-8")


def main(argv: list[str] | None = None) -> int:
    parser = argparse.ArgumentParser(description="UN 2025 worldwide 1M+ urban centres for ASI Cabins")
    parser.add_argument("--input", type=Path, required=True, help="Official WUP2025-F21-DEGURBA-Cities_Pop.xlsx")
    parser.add_argument("--output", type=Path, default=Path("cabins-world-cities.jsonl"))
    args = parser.parse_args(argv)
    cities, manifest = load_global_cities(args.input)
    if not cities:
        parser.error("No qualifying urban areas; check the UN source file")
    write_catalog(cities, manifest, args.output)
    print("Selected worldwide urban areas:", len(cities))
    print("Countries/areas:", len(manifest["eligible_urban_areas_by_country"]))
    print("Excluded countries:", ", ".join(manifest["excluded_country_codes"]))
    for code in ("RU", "JP", "TW", "KR"):
        print(f"  {code}: {manifest['eligible_urban_areas_by_country'].get(code, 0)}")
    print("Catalog:", args.output)
    print("CSV:", args.output.with_suffix(".csv"))
    return 0


if __name__ == "__main__":
    raise SystemExit(main())
