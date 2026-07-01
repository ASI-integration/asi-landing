#!/usr/bin/env python3
"""Apply booking_inbound_intake_events v1 migration via SUPABASE_DB_URL or REST probe."""
from __future__ import annotations

import os
import sys
from pathlib import Path

SQL = (
    Path(__file__).resolve().parent.parent
    / "supabase/migrations/20260701150000_booking_inbound_intake_events_v1.sql"
).read_text(encoding="utf-8")


def probe(url: str, key: str) -> tuple[bool, str]:
    import httpx

    headers = {"apikey": key, "Authorization": f"Bearer {key}"}
    base = url.rstrip("/").replace("/rest/v1", "").replace("/rest/v1/", "")
    r = httpx.get(
        f"{base}/rest/v1/booking_inbound_intake_events?select=id&limit=1",
        headers=headers,
        timeout=20,
        trust_env=False,
    )
    if r.status_code == 200:
        return True, "select_status=200"
    return False, f"select_status={r.status_code} body={r.text[:300]}"


def main() -> int:
    db_url = os.environ.get("SUPABASE_DB_URL", "").strip() or os.environ.get("DATABASE_URL", "").strip()
    url = os.environ.get("SUPABASE_URL", "").strip() or os.environ.get("NEXT_PUBLIC_SUPABASE_URL", "").strip()
    key = os.environ.get("SUPABASE_SERVICE_ROLE_KEY", "").strip()
    if not url or not key:
        print("missing supabase rest env", file=sys.stderr)
        return 1

    ok, detail = probe(url, key)
    print("BEFORE", ok, detail)
    if ok:
        print("MIGRATION_STATUS=already_applied")
        return 0

    if not db_url:
        print("MIGRATION_STATUS=needs_ddl_no_db_url")
        return 2

    try:
        import psycopg2
    except ImportError:
        import subprocess

        subprocess.check_call([sys.executable, "-m", "pip", "install", "psycopg2-binary", "-q"])
        import psycopg2

    conn = psycopg2.connect(db_url)
    conn.autocommit = True
    with conn.cursor() as cur:
        cur.execute(SQL)
    conn.close()

    ok, detail = probe(url, key)
    print("AFTER", ok, detail)
    if ok:
        print("MIGRATION_STATUS=applied_now")
        return 0
    print("MIGRATION_STATUS=apply_failed")
    return 3


if __name__ == "__main__":
    raise SystemExit(main())
