"""One new protected staging-only read-only survey; no unit apply or reload."""
import json
import os
from pathlib import Path

import c4_unit_contract as c
import protected_c4_operator_repair as transport
import protected_c4_unit_readonly as reader

WORKFLOW_FILE = "strigunov4-c4-unit-reload-survey.yml"
WORKFLOW = transport.REPO + "/.github/workflows/" + WORKFLOW_FILE + "@refs/heads/main"
PREFIX = "READONLY_C4_RELOAD_SURVEY_"
PREVIOUS_RUN = 39261951787
PREVIOUS_SHA = "af468d85c8eaf308796bbdbb29b60a59270c45eb"
PREVIOUS_WORKFLOW = 389315707


def validate(env):
    """Bind existing owner/main/attempt/SSH guards to this distinct read scope."""
    return transport.validate(env, workflow=WORKFLOW, confirmation=PREFIX,
                              incident=c.INCIDENT)


def admit(env, fetch=reader.get_json):
    """Require first survey dispatch, old read provenance and quiet Actions."""
    sha, rid, _, _ = validate(env)
    token = env.get("GITHUB_TOKEN", "")
    transport.require(type(token) is str and len(token) > 20, "GITHUB_TOKEN")
    main = fetch("branches/main", token)
    transport.require(main["commit"]["sha"] == sha and main["protected"] is True,
                      "CURRENT_PROTECTED_MAIN")
    workflow = fetch("actions/workflows/" + WORKFLOW_FILE, token)
    transport.require(workflow.get("path") == ".github/workflows/" + WORKFLOW_FILE
                      and workflow.get("state") == "active"
                      and type(workflow.get("id")) is int, "WORKFLOW_IDENTITY")
    runs = fetch("actions/workflows/" + WORKFLOW_FILE + "/runs?event=workflow_dispatch&per_page=100", token)
    values = runs.get("workflow_runs")
    transport.require(type(runs.get("total_count")) is int and runs["total_count"] == 1
                      and type(values) is list and len(values) == 1,
                      "PRIOR_OR_COMPETING_DISPATCH")
    entry = values[0]
    exact = {"id": int(rid), "workflow_id": workflow["id"], "run_attempt": 1,
             "head_sha": sha, "head_branch": "main", "event": "workflow_dispatch"}
    transport.require(all(type(entry.get(k)) is type(v) and entry[k] == v
                          for k, v in exact.items()), "RUN_IDENTITY")
    past = fetch("actions/workflows/strigunov4-c4-unit-receipt-once.yml/runs?event=workflow_dispatch&per_page=100", token)
    items = past.get("workflow_runs")
    old = {"id": PREVIOUS_RUN, "head_sha": PREVIOUS_SHA, "workflow_id": PREVIOUS_WORKFLOW,
           "run_attempt": 1, "head_branch": "main", "event": "workflow_dispatch",
           "status": "completed", "conclusion": "success"}
    transport.require(type(past.get("total_count")) is int and past["total_count"] == 1
                      and type(items) is list and len(items) == 1
                      and all(type(items[0].get(k)) is type(v) and items[0][k] == v
                              for k, v in old.items()), "PREVIOUS_RUN")
    for status in ("queued", "in_progress", "waiting", "pending", "requested"):
        active = fetch("actions/runs?status=" + status + "&per_page=100", token)
        runs_now = active.get("workflow_runs")
        transport.require(type(active.get("total_count")) is int
                          and type(runs_now) is list
                          and active["total_count"] == len(runs_now) <= 100
                          and all(type(x.get("id")) is int
                                  and x["id"] == int(rid) for x in runs_now),
                          "COMPETING_OPERATION")
    return sha, rid


def payload(root=transport.SOURCE):
    """Embed only fixed reviewed read-only sources; no transaction is sent."""
    names = (
        "staging_no_send_patch",
        "staging_no_send_host",
        "c4_operator_patch",
        "c4_unit_contract",
        "c4_unit_readonly",
        "c4_unit_repair_phase_contract",
        "c4_unit_repair_host_preflight",
        "c4_unit_reload_survey",
    )
    sections = ["import sys,types,json\nsys.dont_write_bytecode=True\n"]
    for name in names:
        source = (Path(root) / "scripts/strigunov4" / (name + ".py")).read_text("utf-8")
        transport.require(0 < len(source) < 40000, "SOURCE_SIZE")
        sections.append("m=types.ModuleType(" + repr(name) + ")\n")
        sections.append("sys.modules[" + repr(name) + "]=m\n")
        sections.append("exec(compile(" + repr(source) + "," + repr(name) + ",'exec'),m.__dict__)\n")
    sections.append("""
try:
    if len(sys.argv) != 3 or not sys.argv[1].isdecimal() or len(sys.argv[2]) != 40:
        raise RuntimeError("ARGS")
    report=sys.modules["c4_unit_reload_survey"].survey()
    print(json.dumps(report,sort_keys=True))
except BaseException:
    print('{"status":"C4_MANAGER_SURVEY_BLOCK"}')
    raise SystemExit(2)
""")
    return "".join(sections).encode("utf-8")


def decode(raw, returncode):
    """Reject unknown fields, raw metadata and failures masquerading as success."""
    c.require(type(raw) is bytes and len(raw) <= 4096, "SIZE")
    value = c.strict_json(raw)
    transport.require(returncode == 0 and type(value) is dict, "REMOTE_BLOCK")
    fixed = {
        "status": "READONLY_MANAGER_SURVEY",
        "unit": "OLD_OPTIONAL_PREFLIGHT_PASS",
        "isolation": "MANAGER_WIDE_NOT_PROVEN",
        "daemonReloadAuthorized": False,
        "snapshot": "NON_ATOMIC_CURRENT_ONLY",
    }
    allowed = {"services": {"NO_FORBIDDEN_SERVICE_OBSERVED", "CONFLICT_OR_UNKNOWN"},
               "jobs": {"NONE_OBSERVED", "PRESENT"},
               "generators": {"NONE_OBSERVED", "PRESENT", "UNKNOWN"}}
    transport.require(set(value) == set(fixed) | set(allowed) | {"servicesSeen"}, "SCHEMA")
    transport.require(all(type(value[k]) is type(v) and value[k] == v for k, v in fixed.items()), "SCHEMA")
    transport.require(type(value["servicesSeen"]) is int and 0 <= value["servicesSeen"] <= 1000, "SCHEMA")
    transport.require(all(type(value[k]) is str and value[k] in vals
                          for k, vals in allowed.items()), "SCHEMA")
    transport.require((value["services"] == "CONFLICT_OR_UNKNOWN") ==
                      (value["servicesSeen"] == 0), "SCHEMA")
    return value


def main():
    """Run only one owner-approved staging reader; never print raw errors."""
    try:
        sha, rid = admit(os.environ)
        result = transport.execute(os.environ, admit=validate, build=payload, decode=decode)
        print(json.dumps(result, sort_keys=True))
        return 0
    except BaseException:
        print('{"status":"C4_MANAGER_SURVEY_ADMISSION_OR_READ_BLOCK"}')
        return 2


if __name__ == "__main__":
    raise SystemExit(main())
