"""Main-only, reviewer-gated read-only observer using the reviewed SSH transport."""
import json
import os
from pathlib import Path

import c4_operator_host as host
import c4_operator_observer as observer
import protected_c4_operator_repair as transport

WORKFLOW = transport.REPO + "/.github/workflows/strigunov4-c4-retained-readonly.yml@refs/heads/main"


def validate(env):
    """A distinct scope, incident and confirmation cannot authorize the writer."""
    transport.require(env.get("C4_DIAGNOSTIC_SCOPE") == "operator-39145734946", "SCOPE")
    return transport.validate(env, workflow=WORKFLOW, confirmation="READONLY_C4_OPERATOR_",
                              incident=observer.FAILED_RUN)


def payload(root=transport.SOURCE):
    """Embed trusted modules without executing any writer entry point."""
    modules = ("staging_no_send_patch", "staging_no_send_host", "c4_operator_patch", "c4_operator_host")
    parts = ["import sys,types\n"]
    for name in modules:
        source = (Path(root) / ("scripts/strigunov4/" + name + ".py")).read_text("utf-8")
        transport.require(0 < len(source) < 40000, "SOURCE_SIZE")
        parts.append("m=types.ModuleType(" + repr(name) + ")\n")
        parts.append("exec(compile(" + repr(source) + "," + repr(name) + ",'exec'),m.__dict__)\n")
        parts.append("sys.modules[" + repr(name) + "]=m\n")
    worker = (Path(root) / "scripts/strigunov4/c4_operator_observer.py").read_text("utf-8")
    transport.require(0 < len(worker) < 40000, "SOURCE_SIZE")
    return ("".join(parts) + worker).encode("utf-8")


def decode(raw, returncode):
    """Accept only exact keys and allowlisted nonsecret aggregate values."""
    def block():
        raise transport.RemoteOutcome("BLOCK_REASON_UNKNOWN")
    if type(raw) is not bytes or len(raw) > 4096:
        block()
    try:
        data = observer.strict_json(raw)
    except (ValueError, UnicodeError):
        block()
    if type(data) is not dict:
        block()
    if returncode != 0:
        code = data.get("status")
        if set(data) == {"status"} and type(code) is str and code in host.BLOCKS:
            raise transport.RemoteOutcome(code)
        block()
    fixed = {"status": "C4_OPERATOR_OBSERVED", "incidentRun": observer.FAILED_RUN,
             "snapshot": "NON_ATOMIC_CURRENT_ONLY", "historicalWrite": "UNKNOWN",
             "replayAllowed": False, "databaseState": "NOT_OBSERVED"}
    allowed = dict(observer.FIELD_STATES, lock=observer.LOCK_STATES)
    allowed.update(environmentFiles={"NOT_OBSERVED", "EXACT_EXPECTED", "EXPECTED_PATH_OTHER_FORMAT", "OTHER"} | host.BLOCKS,
                   live={"NOT_OBSERVED", "PASS"} | host.BLOCKS,
                   envPlan={"NOT_OBSERVED", "CHANGE_NEEDED", "ALREADY_CONFIGURED"} | host.BLOCKS,
                   membership={"NOT_OBSERVED", "PROCESS_FILE_MISMATCH", "FIXED_OPERATOR_PRESENT", "FIXED_OPERATOR_MISSING"})
    if set(data) != set(fixed) | set(allowed):
        block()
    if any(type(data[k]) is not type(v) or data[k] != v for k, v in fixed.items()):
        block()
    if any(type(data[k]) is not str or data[k] not in values for k, values in allowed.items()):
        block()
    return data


def main():
    """Run only the fixed read observer after normal GitHub owner/SHA admission."""
    try:
        report = transport.execute(os.environ, admit=validate, build=payload, decode=decode)
        print(json.dumps(report, sort_keys=True))
        return 0
    except transport.RemoteOutcome as error:
        print(json.dumps({"status": error.status}))
    except BaseException:
        print('{"status":"OBSERVER_ADMISSION_OR_TRANSPORT_BLOCK"}')
    return 2


if __name__ == "__main__":
    raise SystemExit(main())
