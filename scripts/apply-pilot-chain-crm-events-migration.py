#!/usr/bin/env python3
"""Apply pilot-chain crm_events type constraint via SUPABASE_DB_URL or DATABASE_URL."""
from __future__ import annotations

import os
import sys
from pathlib import Path

SQL = (Path(__file__).resolve().parent.parent / "supabase/migrations/20260625000001_pilot_chain_crm_events_types.sql").read_text(
    encoding="utf-8"
)


def probe(url: str, key: str) -> tuple[bool, str]:
    import httpx

    headers = {"apikey": key, "Authorization": f"Bearer {key}", "Prefer": "return=representation"}
    base = url.rstrip("/").replace("/rest/v1", "").replace("/rest/v1/", "")
    row = {
        "contact_id": "00000000-0000-0000-0000-000000000001",
        "event_type": "lead_to_object_created",
        "message_text": "migration probe",
        "metadata": {"integration": "pilot_chain", "migration_probe": True},
    }
    r = httpx.post(
        f"{base}/rest/v1/crm_events",
        headers=headers,
        json=row,
        timeout=20,
        trust_env=False,
    )
    if r.status_code not in (200, 201):
        return False, f"insert_status={r.status_code} body={r.text[:300]}"
    data = r.json()
    event_id = data[0]["id"] if isinstance(data, list) and data else data.get("id")
    if event_id:
        httpx.delete(
            f"{base}/rest/v1/crm_events?id=eq.{event_id}",
            headers=headers,
            timeout=20,
            trust_env=False,
        )
    return True, "ok"


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
