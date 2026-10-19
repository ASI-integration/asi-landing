"""One new read-only observation after consumed run 39235934084; encrypted receipt."""
import os

import c4_unit_contract as c
import c4_unit_receipt_envelope as envelope
import protected_c4_operator_repair as transport
import protected_c4_unit_readonly as reader

WORKFLOW_FILE = "strigunov4-c4-unit-receipt-once.yml"
WORKFLOW = transport.REPO + "/.github/workflows/" + WORKFLOW_FILE + "@refs/heads/main"
PREFIX = "READONLY_C4_UNIT_RECEIPT_"
PREVIOUS_RUN = 39235934084
PREVIOUS_SHA = "fe205de63bf23159fd6872ebe078548458fbc9cd"
PREVIOUS_WORKFLOW = 389172998


def validate(env):
    """Apply existing owner, source, attempt and staging transport admission checks."""
    return transport.validate(env, workflow=WORKFLOW, confirmation=PREFIX, incident=c.INCIDENT)


def one_run(value):
    """Require exactly one visible dispatch without hidden or additional history."""
    transport.require(type(value.get("total_count")) is int and value["total_count"] == 1
                      and type(value.get("workflow_runs")) is list
                      and len(value["workflow_runs"]) == 1, "PRIOR_OR_COMPETING_DISPATCH")
    return value["workflow_runs"][0]


def admit(env, fetch=reader.get_json):
    """Verify protected main, both dispatch histories and a quiet Actions window."""
    sha, rid, _, _ = validate(env)
    token = env.get("GITHUB_TOKEN", "")
    transport.require(type(token) is str and len(token) > 20, "GITHUB_TOKEN")
    main = fetch("branches/main", token)
    transport.require(main["commit"]["sha"] == sha and main["protected"] is True, "CURRENT_PROTECTED_MAIN")
    workflow = fetch("actions/workflows/" + WORKFLOW_FILE, token)
    transport.require(workflow["path"] == ".github/workflows/" + WORKFLOW_FILE
                      and workflow["state"] == "active" and type(workflow["id"]) is int, "WORKFLOW_IDENTITY")
    run = one_run(fetch("actions/workflows/" + WORKFLOW_FILE + "/runs?event=workflow_dispatch&per_page=100", token))
    transport.require(type(run["id"]) is int and str(run["id"]) == rid
                      and run["event"] == "workflow_dispatch" and run["head_sha"] == sha
                      and run["head_branch"] == "main" and type(run["run_attempt"]) is int
                      and run["run_attempt"] == 1 and type(run["workflow_id"]) is int
                      and run["workflow_id"] == workflow["id"], "RUN_IDENTITY")
    old = one_run(fetch("actions/workflows/" + reader.WORKFLOW_FILE + "/runs?event=workflow_dispatch&per_page=100", token))
    exact = {"id": PREVIOUS_RUN, "head_sha": PREVIOUS_SHA, "run_attempt": 1,
             "workflow_id": PREVIOUS_WORKFLOW, "event": "workflow_dispatch", "head_branch": "main",
             "status": "completed", "conclusion": "success"}
    transport.require(all(type(old.get(k)) is type(v) and old[k] == v for k, v in exact.items()), "PREVIOUS_RUN")
    for state in ("queued", "in_progress", "waiting", "pending", "requested"):
        # Existing protected staging operations can also be triggered by push.
        # Require a quiet Actions window; an event filter would miss those jobs.
        active = fetch("actions/runs?status=" + state + "&per_page=100", token)
        values = active.get("workflow_runs")
        transport.require(type(values) is list and type(active.get("total_count")) is int
                          and active["total_count"] == len(values) <= 100
                          and all(type(x.get("id")) is int and str(x["id"]) == rid for x in values),
                          "COMPETING_OPERATION")
    return sha, rid


def main():
    """Admit one fixed observation and save only its validated encrypted receipt."""
    try:
        sha, rid = admit(os.environ)
        cert, folder = envelope.prepare(os.environ)
        # Recheck after crypto/output preflight, immediately before transport.
        transport.require(admit(os.environ) == (sha, rid), "ADMISSION_CHANGED")
        value = transport.execute(os.environ, admit=validate, build=reader.payload,
                                  decode=lambda raw, code: reader.decode(raw, code, sha, rid))
        envelope.save(value, sha, rid, cert, folder, os.environ["GITHUB_OUTPUT"])
        # No post-save file/output/log write can prevent upload. The final
        # verify-download step, after upload, emits the success status.
        return 0
    except transport.RemoteOutcome as error:
        code = error.status if error.status in {"C4_UNIT_BLOCK_" + r for r in c.REASONS} else "C4_UNIT_BLOCK_UNKNOWN"
        print('{"status":"' + code + '"}')
    except BaseException:
        print('{"status":"C4_UNIT_RECEIPT_ADMISSION_OR_STORAGE_BLOCK"}')
    return 2


if __name__ == "__main__":
    raise SystemExit(main())
