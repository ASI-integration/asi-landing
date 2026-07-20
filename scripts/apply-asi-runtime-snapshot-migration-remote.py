#!/usr/bin/env python3
"""Apply ASI Runtime snapshot v1 migration on production without printing secrets."""
from __future__ import annotations

import os
import sys
import urllib.error
import urllib.request
from pathlib import Path

ENV_CANDIDATES = (
    Path("/var/www/asi/shared/.env.production.live"),
    Path("/var/www/asi/current/.env.production.local"),
    Path("/var/www/asi/current/.env.production.live"),
)
SQL_FILE = Path("/tmp/asi_runtime_snapshot_v1.sql")
REQUIRED_TABLE = "asi_runtime_snapshots"


def load_env_file(path: Path) -> None:
    if not path.is_file():
        return
    for line in path.read_text(encoding="utf-8").splitlines():
        line = line.strip()
        if not line or line.startswith("#") or "=" not in line:
            continue
        key, val = line.split("=", 1)
        os.environ.setdefault(key.strip(), val.strip().strip('"').strip("'"))


def load_pm2_env() -> None:
    import subprocess

    try:
        out = subprocess.check_output(
            ["sudo", "-u", "project_ayfaar", "pm2", "env", "0"],
            text=True,
            stderr=subprocess.DEVNULL,
        )
    except (subprocess.CalledProcessError, FileNotFoundError):
        return
    for line in out.splitlines():
        for prefix in ("SUPABASE_DB_URL:", "DATABASE_URL:", "PRODUCTION_DATABASE_URL:"):
            if line.startswith(prefix):
                os.environ.setdefault(prefix[:-1], line.split(":", 1)[1].strip())


def rest_base() -> tuple[str, str] | None:
    url = os.environ.get("NEXT_PUBLIC_SUPABASE_URL", "").rstrip("/").replace("/rest/v1", "")
    key = os.environ.get("SUPABASE_SERVICE_ROLE_KEY", "")
    if not url or not key:
        return None
    return url, key


def probe_table() -> tuple[bool, str]:
    env = rest_base()
    if not env:
        return False, "missing_rest_env"
    url, key = env
    req = urllib.request.Request(
        f"{url}/rest/v1/{REQUIRED_TABLE}?select=user_id&limit=1",
        headers={"apikey": key, "Authorization": f"Bearer {key}"},
        method="GET",
    )
    try:
        with urllib.request.urlopen(req, timeout=20) as resp:
            return resp.status == 200, f"select_status={resp.status}"
    except urllib.error.HTTPError as exc:
        body = exc.read(240).decode("utf-8", "replace")
        return False, f"select_status={exc.code} body={body}"


def apply_sql() -> None:
    db_url = (
        os.environ.get("SUPABASE_DB_URL", "").strip()
        or os.environ.get("DATABASE_URL", "").strip()
        or os.environ.get("PRODUCTION_DATABASE_URL", "").strip()
    )
    if not db_url:
        print("MIGRATION_STATUS=needs_ddl_no_db_url")
        raise SystemExit(2)
    try:
        import psycopg2
    except ImportError:
        import subprocess

        subprocess.check_call([sys.executable, "-m", "pip", "install", "psycopg2-binary", "-q"])
        import psycopg2

    sql = SQL_FILE.read_text(encoding="utf-8")
    conn = psycopg2.connect(db_url)
    conn.autocommit = True
    with conn.cursor() as cur:
        cur.execute(sql)
        cur.execute("NOTIFY pgrst, 'reload schema';")
    conn.close()
    print("MIGRATION_STATUS=applied_now")


def main() -> int:
    for path in ENV_CANDIDATES:
        load_env_file(path)
    load_pm2_env()
    print(f"has_db_url={'yes' if os.environ.get('SUPABASE_DB_URL') or os.environ.get('DATABASE_URL') or os.environ.get('PRODUCTION_DATABASE_URL') else 'no'}")

    ok, detail = probe_table()
    print("BEFORE", ok, detail)
    if ok:
        print("MIGRATION_STATUS=already_applied")
        return 0

    apply_sql()
    ok, detail = probe_table()
    print("AFTER", ok, detail)
    if ok:
        return 0
    print("MIGRATION_STATUS=apply_failed")
    return 3


if __name__ == "__main__":
    raise SystemExit(main())
