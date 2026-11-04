#!/usr/bin/env python3
"""Build a Southeast Asia populated-place catalog from GeoNames country dumps.

Does not crawl property listings. GeoNames country archives are CC BY 4.0:
https://www.geonames.org/export/  (provide attribution on reused data).
"""
from __future__ import annotations

import argparse
from datetime import datetime, timezone
from hashlib import sha256
import io
import json
from pathlib import Path
import shutil
import tempfile
from urllib.request import Request, urlopen
import zipfile

COUNTRIES = {
    "BN": "Brunei", "KH": "Cambodia", "ID": "Indonesia",
    "LA": "Laos", "MY": "Malaysia", "MM": "Myanmar",
    "PH": "Philippines", "SG": "Singapore", "TH": "Thailand",
    "TL": "Timor-Leste", "VN": "Vietnam",
}
# Settlements, including towns and small villages. Exclude abandoned,
# historical, sections-of-populated-place and religious-only features.
EXCLUDE_FEATURE_CODES = {"PPLQ", "PPLH", "PPLX", "PPLR", "PPLW"}
GEONAMES_BASE = "https://download.geonames.org/export/dump/"
MAX_COMPRESSED_BYTES = 160_000_000
MAX_UNCOMPRESSED_BYTES = 1_000_000_000


def parse_geonames_line(line: str, country: str, population_min: int = 2) -> dict | None:
    fields = line.rstrip("\r\n").split("\t")
    if len(fields) < 19 or fields[6] != "P" or fields[7] in EXCLUDE_FEATURE_CODES:
        return None
    if fields[8] != country:
        return None
    try:
        population = int(fields[14] or "0")
        if population < population_min:
            return None
        latitude = float(fields[4])
        longitude = float(fields[5])
        geonames_id = int(fields[0])
    except (ValueError, IndexError):
        return None
    if not (-90 <= latitude <= 90 and -180 <= longitude <= 180):
        return None
    name = fields[1].strip()
    if not name:
        return None
    return {
        "id": f"geonames:{geonames_id}",
        "name": name,
        "country_code": country,
        "country": COUNTRIES[country],
        "admin1": fields[10],
        "admin2": fields[11],
        "latitude": latitude,
        "longitude": longitude,
        "population": population,
        "feature_code": fields[7],
        "source": "GeoNames (CC BY 4.0)",
    }


def download_archive(country: str, cache_dir: Path, replace: bool = False) -> Path:
    if country not in COUNTRIES:
        raise ValueError(f"Unsupported country: {country}")
    cache_dir.mkdir(parents=True, exist_ok=True)
    target = cache_dir / f"{country}.zip"
    if target.exists() and not replace:
        return target
    url = f"{GEONAMES_BASE}{country}.zip"
    # Only a fixed, owned destination and an explicitly designated public dataset.
    with tempfile.NamedTemporaryFile(dir=cache_dir, suffix=".tmp", delete=False) as temp:
        temp_name = Path(temp.name)
        try:
            with urlopen(Request(url, headers={"User-Agent": "ASI-Cabins-Research/0.1"}), timeout=45) as response:
                # Fail if redirected away from GeoNames HTTPS.
                if response.geturl() != url:
                    raise ValueError("Unexpected GeoNames redirect")
                count = 0
                while True:
                    chunk = response.read(64_000)
                    if not chunk:
                        break
                    count += len(chunk)
                    if count > MAX_COMPRESSED_BYTES:
                        raise ValueError("GeoNames archive exceeds size limit")
                    temp.write(chunk)
            with zipfile.ZipFile(temp_name) as archive:
                expected = f"{country}.txt"
                info = archive.getinfo(expected)
                if info.file_size > MAX_UNCOMPRESSED_BYTES:
                    raise ValueError("GeoNames archive member exceeds size limit")
            temp_name.replace(target)
        finally:
            if temp_name.exists():
                temp_name.unlink()
    return target


def iter_country(path: Path, country: str, population_min: int = 2):
    if path.suffix == ".zip":
        with zipfile.ZipFile(path) as archive:
            info = archive.getinfo(f"{country}.txt")
            if info.file_size > MAX_UNCOMPRESSED_BYTES:
                raise ValueError(f"{country}: uncompressed archive exceeds size limit")
            with archive.open(info) as source:
                for line in io.TextIOWrapper(source, encoding="utf-8", errors="replace"):
                    record = parse_geonames_line(line, country, population_min)
                    if record:
                        yield record
    else:
        with path.open(encoding="utf-8", errors="replace") as source:
            for line in source:
                record = parse_geonames_line(line, country, population_min)
                if record:
                    yield record


def build_catalog(
    cache_dir: Path, output: Path, selected: list[str],
    population_min: int = 2, download: bool = False,
    refresh: bool = False,
) -> dict:
    if population_min < 2:
        raise ValueError("Population minimum must be at least two")
    selected = list(dict.fromkeys(code.upper() for code in selected))
    invalid = sorted(set(selected) - set(COUNTRIES))
    if invalid:
        raise ValueError("Unknown countries: " + ", ".join(invalid))
    output.parent.mkdir(parents=True, exist_ok=True)
    stats = {code: 0 for code in selected}
    hashes: dict[str, str] = {}
    seen: set[str] = set()
    count = 0
    with tempfile.NamedTemporaryFile(
        mode="w", encoding="utf-8", dir=output.parent,
        prefix=".cities-", suffix=".tmp", delete=False,
    ) as stream:
        temporary = Path(stream.name)
        try:
            for code in selected:
                archive_path = cache_dir / f"{code}.zip"
                txt_path = cache_dir / f"{code}.txt"
                if download:
                    archive_path = download_archive(code, cache_dir, replace=refresh)
                elif not archive_path.exists() and txt_path.exists():
                    archive_path = txt_path
                if not archive_path.exists():
                    raise FileNotFoundError(
                        f"Missing {archive_path}; supply GeoNames {code}.zip or use --download"
                    )
                checksum = sha256()
                with archive_path.open("rb") as raw:
                    for chunk in iter(lambda: raw.read(1024 * 1024), b""):
                        checksum.update(chunk)
                hashes[code] = checksum.hexdigest()
                for place in iter_country(archive_path, code, population_min):
                    if place["id"] in seen:
                        continue
                    seen.add(place["id"])
                    stream.write(json.dumps(place, ensure_ascii=False) + "\n")
                    stats[code] += 1
                    count += 1
            stream.flush()
            temporary.replace(output)
        finally:
            if temporary.exists():
                temporary.unlink()
    manifest = {
        "generated_at": datetime.now(timezone.utc).isoformat(),
        "dataset": "GeoNames country gazetteer",
        "attribution": "GeoNames: https://www.geonames.org/",
        "license": "CC BY 4.0",
        "population_min": population_min,
        "countries": selected,
        "places_by_country": stats,
        "places_total": count,
        "input_sha256": hashes,
        "caveat": "GeoNames coverage and reported population are incomplete; zero/unknown populations excluded.",
    }
    output.with_suffix(".manifest.json").write_text(
        json.dumps(manifest, ensure_ascii=False, indent=2) + "\n", encoding="utf-8"
    )
    return manifest


def main(argv: list[str] | None = None) -> int:
    parser = argparse.ArgumentParser(description="Generate SEA city/settlement catalog (population >=2)")
    parser.add_argument("--cache-dir", type=Path, default=Path("cabins-geonames-cache"))
    parser.add_argument("--output", type=Path, default=Path("cabins-city-catalog.jsonl"))
    parser.add_argument("--countries", default=",".join(COUNTRIES), help="ISO country codes, comma separated")
    parser.add_argument("--population-min", type=int, default=2)
    parser.add_argument("--download", action="store_true", help="Explicitly download 11 public country data archives")
    parser.add_argument("--refresh", action="store_true", help="Replace cached country archives (with --download)")
    args = parser.parse_args(argv)
    if args.refresh and not args.download:
        parser.error("--refresh requires --download")
    manifest = build_catalog(
        args.cache_dir, args.output,
        [x.strip().upper() for x in args.countries.split(",") if x.strip()],
        args.population_min, args.download, args.refresh
    )
    for country, count in manifest["places_by_country"].items():
        print(f"{country} {COUNTRIES[country]}: {count:,} populated places")
    print(f"TOTAL: {manifest['places_total']:,} populated places -> {args.output}")
    print("GeoNames CC BY 4.0: https://www.geonames.org/")
    return 0


if __name__ == "__main__":
    raise SystemExit(main())
