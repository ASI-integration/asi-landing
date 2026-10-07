#!/usr/bin/env python3
import argparse
import json
import os
import re
import sys
import time
import urllib.error
import urllib.request
from datetime import datetime, timezone
from pathlib import Path

HOME = Path.home()
ROOT = Path(os.environ.get("ASI_MISSION_CONTROL_LOCAL_DIR", str(HOME / ".asi" / "mission-control")))
LATEST = ROOT / "latest.json"

KIM_ROOT = Path(os.environ.get("KIM_PROJECT_ROOT", str(HOME / "Documents" / "Kim Goguen")))
KIM_STATUS = KIM_ROOT / "KIM_OFFICIAL_BATCH_STATUS.json"

ASI_STATUS = Path(os.environ.get(
    "ASI_CONTINUATION_STATUS",
    str(HOME / ".asi" / "continuation" / "telegram-text" / "status.json"),
))

ORIS_ROOT = Path(os.environ.get("ORIS_PROJECT_ROOT", str(HOME / "Documents" / "IISSIIDIOLOGY_ARCHIVE_INDEX")))
ORIS_MASTER = ORIS_ROOT / "master_library_v1_summary.json"
ORIS_WRITTEN = ORIS_ROOT / "written_index_v1_summary.json"

DEFAULT_ENDPOINT = "https://asi-global.ru/api/internal/mission-control/status"


def iso_from_mtime(path: Path) -> str:
    try:
        ts = path.stat().st_mtime
    except OSError:
        ts = time.time()
    return datetime.fromtimestamp(ts, tz=timezone.utc).isoformat(timespec="seconds")


def load_json(path: Path):
    try:
        return json.loads(path.read_text(encoding="utf-8-sig"))
    except Exception:
        return None


def tail_text(path: Path, size: int = 96_000) -> str:
    try:
        with path.open("rb") as f:
            f.seek(0, os.SEEK_END)
            length = f.tell()
            f.seek(max(0, length - size), os.SEEK_SET)
            return f.read().decode("utf-8", "replace")
    except OSError:
        return ""


def find_kim_log(status: dict) -> Path | None:
    current = status.get("current") or {}
    date = str(current.get("date") or "").strip()
    cid = str(current.get("cid") or "").strip()
    if not date or not cid:
        return None
    path = KIM_ROOT / f"KIM_BATCH_{date}_{cid}.log"
    return path if path.exists() else None


def kim_payload() -> dict:
    status = load_json(KIM_STATUS) or {}
    total = int(status.get("total") or 0)
    completed = len(status.get("completed_cids") or [])
    failures = status.get("failures") or {}
    current = status.get("current") or {}
    stage_raw = str(status.get("stage") or "idle")

    stage_labels = {
        "starting": "ПОДГОТОВКА",
        "refresh_auth": "АВТОРИЗАЦИЯ UNN",
        "resolve_full_mux": "ПОИСК ПОТОКА",
        "download_audio": "СКАЧИВАНИЕ",
        "transcribe_ingest_index": "ТРАНСКРИПЦИЯ",
        "item_complete": "ИНДЕКСАЦИЯ ГОТОВА",
        "skip_already_ingested": "ПРОВЕРКА АРХИВА",
        "validate_index": "ПРОВЕРКА ИНДЕКСА",
        "finished": "ГОТОВО",
        "finished_validation_failed": "ОШИБКА ПРОВЕРКИ",
        "item_failed_continue": "ОШИБКА ФАЙЛА",
    }
    stage = stage_labels.get(stage_raw, stage_raw.replace("_", " ").upper() or "НЕТ ДАННЫХ")

    stage_progress = None
    speed = ""
    eta = ""
    log_path = find_kim_log(status)
    log_text = tail_text(log_path) if log_path else ""

    if stage_raw == "download_audio":
        matches = re.findall(
            r"\[download\]\s+([0-9.]+)%[^\r\n]*?\bat\s+(\S+)\s+ETA\s+([0-9:]+)",
            log_text,
        )
        if matches:
            pct, speed, eta = matches[-1]
            stage_progress = float(pct)

    if stage_raw == "transcribe_ingest_index":
        matches = re.findall(
            r"(\d+)%\|[^\r\n]*?<([0-9:]+),\s*([0-9.]+)seconds/s",
            log_text,
        )
        if matches:
            pct, eta, rate = matches[-1]
            stage_progress = float(pct)
            seconds_per_second = float(rate)
            if seconds_per_second > 0:
                speed = f"{(1.0 / seconds_per_second):.2f}× realtime"
        elif "DONE" in log_text.upper():
            stage_progress = 100.0
            stage = "ИНДЕКСАЦИЯ"

    if status.get("finished") is True:
        stage_progress = 100.0

    partial = (stage_progress or 0.0) / 100.0 if current else 0.0
    overall = ((completed + partial) / total * 100.0) if total else 0.0

    if status.get("finished") is True and not failures:
        kind = "done"
    elif stage_raw == "finished_validation_failed":
        kind = "error"
    elif current:
        kind = "running"
    elif failures:
        kind = "error"
    else:
        kind = "waiting"

    updated_candidates = [KIM_STATUS]
    if log_path:
        updated_candidates.append(log_path)
    updated_path = max(
        (p for p in updated_candidates if p.exists()),
        key=lambda p: p.stat().st_mtime,
        default=KIM_STATUS,
    )

    title = str(current.get("title") or "")
    index = int(current.get("index") or 0)
    last_event = f"Файл {index}/{total}" if index and total else ""
    if failures:
        last_event = (last_event + " · " if last_event else "") + f"ошибок: {len(failures)}"

    return {
        "projectId": "kim",
        "status": kind,
        "stage": stage,
        "progressPercent": round(overall, 1),
        "stageProgressPercent": round(stage_progress, 1) if stage_progress is not None else None,
        "completedItems": completed,
        "totalItems": total,
        "currentItem": title[:320],
        "speed": speed[:80],
        "eta": eta[:80],
        "lastEvent": last_event[:500],
        "updatedAt": iso_from_mtime(updated_path),
    }


def asi_payload() -> dict:
    status = load_json(ASI_STATUS) or {}
    task = str(status.get("task") or "telegram-text")
    phase = str(status.get("phase") or status.get("status") or "idle")
    blocker = str(status.get("blocker") or "")
    run_conclusion = str(status.get("runConclusion") or "")
    run_status = str(status.get("runStatus") or "")
    production_sha = str(status.get("productionSha") or status.get("mainSha") or "")

    if run_conclusion == "failure" or blocker.startswith("acceptance_failed"):
        kind = "error"
        stage = "PRODUCTION ACCEPTANCE"
    elif run_status in {"queued", "in_progress", "waiting"}:
        kind = "running" if run_status != "waiting" else "waiting"
        stage = "CI / PRODUCTION"
    elif phase in {"timeout", "blocked", "waiting"}:
        kind = "waiting"
        stage = phase.upper()
    elif run_conclusion == "success":
        kind = "done"
        stage = "ACCEPTANCE ГОТОВ"
    else:
        kind = "idle"
        stage = phase.replace("_", " ").upper() or "НЕТ ДАННЫХ"

    if task == "telegram-text" and blocker.startswith("acceptance_failed"):
        completed_items, total_items, progress = 3, 4, 75.0
    elif run_conclusion == "success":
        completed_items, total_items, progress = 4, 4, 100.0
    else:
        completed_items, total_items, progress = 0, 0, 0.0

    event = ""
    if blocker:
        event = "Acceptance требует исправления"
    elif production_sha:
        event = f"Production SHA {production_sha[:8]}"

    return {
        "projectId": "asi",
        "status": kind,
        "stage": stage,
        "progressPercent": progress,
        "stageProgressPercent": None,
        "completedItems": completed_items,
        "totalItems": total_items,
        "currentItem": "Telegram text production acceptance" if task == "telegram-text" else task[:320],
        "speed": "",
        "eta": "",
        "lastEvent": event[:500],
        "updatedAt": iso_from_mtime(ASI_STATUS),
    }


def oris_payload() -> dict:
    master = load_json(ORIS_MASTER) or {}
    written = load_json(ORIS_WRITTEN) or {}
    canonical = int(master.get("canonical_files") or 0)
    docs = int(written.get("documents_indexed") or 0)
    chunks = int(written.get("chunks") or 0)

    newest = max(
        (p for p in (ORIS_MASTER, ORIS_WRITTEN) if p.exists()),
        key=lambda p: p.stat().st_mtime,
        default=ORIS_MASTER,
    )
    detail = f"Архив: {canonical} файлов · письменный корпус: {docs} документов · {chunks} чанков"

    return {
        "projectId": "oris",
        "status": "waiting",
        "stage": "ОЧЕРЕДЬ НЕ ЗАПУЩЕНА",
        "progressPercent": 0.0,
        "stageProgressPercent": None,
        "completedItems": 0,
        "totalItems": 0,
        "currentItem": detail[:320],
        "speed": "",
        "eta": "",
        "lastEvent": "Инвентаризация архива готова; ждёт следующей обработки.",
        "updatedAt": iso_from_mtime(newest),
    }


def read_env_value(name: str) -> str:
    direct = os.environ.get(name, "").strip()
    if direct:
        return direct

    local_repo = Path(os.environ.get("ASI_LOCAL_REPO", r"C:\asi-landing"))
    candidates = [
        local_repo / ".env.local",
        HOME / "Documents" / "GitHub" / "asi-landing" / ".env.local",
    ]
    pattern = re.compile(rf"^\s*{re.escape(name)}\s*=\s*(.*?)\s*$")
    for path in candidates:
        try:
            for line in path.read_text(encoding="utf-8").splitlines():
                m = pattern.match(line)
                if not m:
                    continue
                value = m.group(1).strip().strip("\"'")
                if value:
                    return value
        except OSError:
            continue
    return ""


def snapshot() -> list[dict]:
    payloads = [kim_payload(), asi_payload(), oris_payload()]
    observed_at = datetime.now(timezone.utc).isoformat(timespec="seconds")
    for payload in payloads:
        # updatedAt is the reporter heartbeat. Source-specific age belongs in lastEvent,
        # so a quiet project does not look disconnected while the reporter is healthy.
        payload["updatedAt"] = observed_at
    return payloads


def save_local(payloads: list[dict]) -> None:
    ROOT.mkdir(parents=True, exist_ok=True)
    temp = LATEST.with_suffix(".json.tmp")
    temp.write_text(
        json.dumps(
            {"updatedAt": datetime.now(timezone.utc).isoformat(timespec="seconds"), "projects": payloads},
            ensure_ascii=False,
            indent=2,
        ),
        encoding="utf-8",
    )
    temp.replace(LATEST)


def push_headers() -> dict[str, str]:
    runtime_token = read_env_value("ASI_RUNTIME_INGEST_TOKEN")
    if runtime_token:
        return {"Authorization": f"Bearer {runtime_token}"}

    internal_secret = read_env_value("INTERNAL_TEST_SECRET")
    if internal_secret:
        return {"x-internal-test-secret": internal_secret}

    return {}


def post_payload(endpoint: str, auth_headers: dict[str, str], payload: dict) -> tuple[bool, str]:
    body = json.dumps(payload, ensure_ascii=False).encode("utf-8")
    request = urllib.request.Request(
        endpoint,
        data=body,
        method="POST",
        headers={
            **auth_headers,
            "Content-Type": "application/json; charset=utf-8",
            "User-Agent": "ASI-Mission-Control-Reporter/1.0",
        },
    )
    try:
        with urllib.request.urlopen(request, timeout=15) as response:
            if 200 <= response.status < 300:
                return True, str(response.status)
            return False, str(response.status)
    except urllib.error.HTTPError as exc:
        return False, str(exc.code)
    except Exception as exc:
        return False, type(exc).__name__


def main():
    if hasattr(sys.stdout, 'reconfigure'):
        sys.stdout.reconfigure(encoding='utf-8', errors='replace')
    parser = argparse.ArgumentParser()
    parser.add_argument("--endpoint", default=os.environ.get("ASI_MISSION_CONTROL_ENDPOINT", DEFAULT_ENDPOINT))
    parser.add_argument("--loop", action="store_true")
    parser.add_argument("--interval", type=float, default=5.0)
    parser.add_argument("--dry-run", action="store_true")
    args = parser.parse_args()

    while True:
        payloads = snapshot()
        save_local(payloads)

        if args.dry_run:
            print(json.dumps({"projects": payloads}, ensure_ascii=False, indent=2))
        else:
            auth_headers = push_headers()
            if not auth_headers:
                print("MISSION_CONTROL_PUSH=skipped credential_missing", flush=True)
            else:
                results = []
                for payload in payloads:
                    ok, detail = post_payload(args.endpoint, auth_headers, payload)
                    results.append(f"{payload['projectId']}={'ok' if ok else 'fail:' + detail}")
                print("MISSION_CONTROL_PUSH " + " ".join(results), flush=True)

        if not args.loop:
            break
        time.sleep(max(2.0, args.interval))


if __name__ == "__main__":
    main()
