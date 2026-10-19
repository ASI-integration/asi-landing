"""Single-purpose main/reviewer gate; no unit contents leave the remote worker."""
import json
import os
from pathlib import Path
import urllib.request

import c4_unit_contract as c
import protected_c4_operator_repair as transport

WORKFLOW_FILE = "strigunov4-c4-unit-readonly.yml"
WORKFLOW = transport.REPO + "/.github/workflows/" + WORKFLOW_FILE + "@refs/heads/main"
PREFIX = "READONLY_C4_UNIT_"


def validate(env):
    return transport.validate(env, workflow=WORKFLOW, confirmation=PREFIX, incident=c.INCIDENT)


def get_json(endpoint, token):
    request = urllib.request.Request("https://api.github.com/repos/" + transport.REPO + "/" + endpoint,
                                    headers={"Authorization": "Bearer " + token,
                                             "Accept": "application/vnd.github+json"})
    with urllib.request.urlopen(request, timeout=15) as response:
        transport.require(response.status == 200, "GITHUB_READ")
        raw = response.read(1048577)
    transport.require(len(raw) <= 1048576, "GITHUB_SIZE")
    return c.strict_json(raw)


def current_main_and_first_dispatch(env, fetch=get_json):
    sha, rid, _, _ = validate(env)
    token = env.get("GITHUB_TOKEN", "")
    transport.require(type(token) is str and len(token) > 20, "GITHUB_TOKEN")
    main = fetch("branches/main", token)
    transport.require(main["commit"]["sha"] == sha and main["protected"] is True, "CURRENT_PROTECTED_MAIN")
    workflow = fetch("actions/workflows/" + WORKFLOW_FILE, token)
    transport.require(workflow["path"] == ".github/workflows/" + WORKFLOW_FILE
                      and workflow["state"] == "active", "WORKFLOW_IDENTITY")
    runs = fetch("actions/workflows/" + WORKFLOW_FILE + "/runs?event=workflow_dispatch&per_page=100", token)
    values = runs.get("workflow_runs", [])
    # This workflow is one incident observation. Even a failed earlier dispatch
    # consumes the procedure; no new SHA, new run ID, or rerun bypasses it.
    transport.require(type(runs.get("total_count")) is int and runs["total_count"] == 1
                      and type(values) is list and len(values) == 1, "PRIOR_OR_COMPETING_DISPATCH")
    run = values[0]
    transport.require(type(run["id"]) is int and str(run["id"]) == rid
                      and run["event"] == "workflow_dispatch" and run["head_sha"] == sha
                      and run["head_branch"] == "main" and type(run["run_attempt"]) is int
                      and run["run_attempt"] == 1 and run["workflow_id"] == workflow["id"], "RUN_IDENTITY")
    # Other staging workflows do not all share one concurrency group. Refuse
    # overlap with any other active manual procedure, including older queues.
    for state in ("queued", "in_progress", "waiting", "pending", "requested"):
        active = fetch("actions/runs?event=workflow_dispatch&status=" + state + "&per_page=100", token)
        values = active.get("workflow_runs")
        transport.require(type(values) is list and type(active.get("total_count")) is int
                          and active["total_count"] == len(values) <= 100
                          and all(type(x.get("id")) is int and str(x["id"]) == rid for x in values),
                          "COMPETING_MANUAL_OPERATION")
    return sha, rid


def payload(root=transport.SOURCE):
    source = (Path(root) / "scripts/strigunov4/c4_unit_contract.py").read_text("utf-8")
    worker = (Path(root) / "scripts/strigunov4/c4_unit_readonly.py").read_text("utf-8")
    transport.require(0 < len(source) < 40000 and 0 < len(worker) < 40000, "SOURCE_SIZE")
    return ("import sys,types\nsys.dont_write_bytecode=True\n"
            "m=types.ModuleType('c4_unit_contract')\n"
            "exec(compile(" + repr(source) + ",'c4_unit_contract','exec'),m.__dict__)\n"
            "sys.modules['c4_unit_contract']=m\n" + worker).encode()


def decode(raw, returncode, sha, rid):
    try:
        c.require(type(raw) is bytes and len(raw) <= 4096 and type(returncode) is int, "SIZE")
        value = c.strict_json(raw)
        if returncode != 0:
            if type(value) is dict and set(value) == {"status"} and type(value["status"]) is str:
                if value["status"] in {"C4_UNIT_BLOCK_" + reason for reason in c.REASONS}:
                    raise transport.RemoteOutcome(value["status"])
            raise c.Block("FORMAT")
        return c.validate_receipt(value, sha, rid)
    except transport.RemoteOutcome:
        raise
    except (ValueError, TypeError, KeyError, UnicodeError):
        raise transport.RemoteOutcome("C4_UNIT_BLOCK_UNKNOWN") from None


def main():
    try:
        sha, rid = current_main_and_first_dispatch(os.environ)
        result = transport.execute(os.environ, admit=validate, build=payload,
                                   decode=lambda raw, code: decode(raw, code, sha, rid))
        print(json.dumps(result, sort_keys=True))
        return 0
    except transport.RemoteOutcome as error:
        # The reusable transport also has fixed failure codes; never echo stdout.
        code = error.status if error.status in {"C4_UNIT_BLOCK_" + r for r in c.REASONS} else "C4_UNIT_BLOCK_UNKNOWN"
        print(json.dumps({"status": code}))
    except BaseException:
        print('{"status":"C4_UNIT_ADMISSION_OR_TRANSPORT_BLOCK"}')
    return 2


if __name__ == "__main__":
    raise SystemExit(main())
