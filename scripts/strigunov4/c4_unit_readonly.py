"""Fixed unit-only observer. Raw unit bytes remain in memory on the host."""
import json
import os
import signal
import subprocess
import sys
import time

import c4_unit_contract as c

HOST = "asi-agent-runner"
PROPERTIES = ("ActiveState", "SubState", "LoadState", "User", "Group", "WorkingDirectory",
              "EnvironmentFiles", "DropInPaths", "FragmentPath", "NeedDaemonReload",
              "MainPID", "InvocationID", "ExecMainStartTimestampMonotonic")


def properties(deadline):
    left = deadline - time.monotonic()
    c.require(left > 0.05, "DEADLINE")
    try:
        r = subprocess.run(["systemctl", "show", c.SERVICE, "--all", "--no-pager",
                            "--property=" + ",".join(PROPERTIES)],
                           stdout=subprocess.PIPE, stderr=subprocess.PIPE,
                           timeout=min(8, left), env={"PATH": "/usr/sbin:/usr/bin:/sbin:/bin", "LC_ALL": "C"})
    except (OSError, subprocess.TimeoutExpired):
        raise c.Block("COMMAND") from None
    c.require(r.returncode == 0 and len(r.stdout) <= 16384, "COMMAND")
    result = {}
    for line in r.stdout.decode("utf-8", "strict").splitlines():
        c.require("=" in line, "PROPERTIES")
        key, value = line.split("=", 1)
        c.require(key in PROPERTIES and key not in result, "PROPERTIES")
        result[key] = value
    c.require(set(result) == set(PROPERTIES), "PROPERTIES")
    return result


def identity(p):
    c.require(p["ActiveState"] == "active" and p["SubState"] == "running"
              and p["LoadState"] == "loaded" and p["User"] == p["Group"] == "asi-runtime"
              and p["WorkingDirectory"] == "/var/www/asi-staging/current"
              and p["FragmentPath"] == c.UNIT and not p["DropInPaths"], "IDENTITY")
    c.require(p["MainPID"].isdecimal() and int(p["MainPID"]) > 1
              and len(p["InvocationID"]) == 32 and all(x in "0123456789abcdef" for x in p["InvocationID"])
              and p["ExecMainStartTimestampMonotonic"].isdecimal()
              and int(p["ExecMainStartTimestampMonotonic"]) > 0, "IDENTITY")
    c.require(p["NeedDaemonReload"] in ("yes", "no"), "PROPERTIES")
    value = p["EnvironmentFiles"]
    c.require(value in (c.ENV + " (ignore_errors=yes)", c.ENV + " (ignore_errors=no)"), "PROPERTIES")
    return "EXACT_EXPECTED_OPTIONAL" if value.endswith("(ignore_errors=yes)") else "EXACT_EXPECTED"


def observe(run_id, source_sha):
    c.require(c.RUN.fullmatch(run_id) and c.SHA.fullmatch(source_sha), "ARGS")
    c.require(os.geteuid() == 0 and os.uname().nodename == HOST, "HOST")
    deadline = time.monotonic() + 30
    fd = c.open_parent("/etc/systemd/system")
    try:
        raw, before, attrs = c.read_regular(fd, "asi-landing-staging.service")
        proposal = c.plan(raw)
        first = properties(deadline)
        env_state = identity(first)
        again, after, attrs_after = c.read_regular(fd, "asi-landing-staging.service")
        second = properties(deadline)
        identity(second)
        path_fd = c.open_parent("/etc/systemd/system")
        try:
            c.require((os.fstat(path_fd).st_dev, os.fstat(path_fd).st_ino)
                      == (os.fstat(fd).st_dev, os.fstat(fd).st_ino), "READ_RACE")
        finally:
            os.close(path_fd)
        c.require(raw == again and c.signature(before) == c.signature(after) and attrs == attrs_after, "READ_RACE")
        keys = ("MainPID", "InvocationID", "ExecMainStartTimestampMonotonic")
        c.require(all(first[k] == second[k] for k in keys), "PROCESS_CHANGED")
        c.require(first == second, "MANAGER_CHANGED")
        c.require(time.monotonic() < deadline, "DEADLINE")
        result = {"status": "C4_UNIT_OBSERVED", "incidentRun": c.INCIDENT,
                  "sourceSha": source_sha, "runId": run_id,
                  "beforeSha256": proposal["beforeSha256"], "afterSha256": proposal["afterSha256"],
                  "unitBytes": proposal["unitBytes"], "removedBytes": proposal["removedBytes"],
                  "planState": proposal["planState"], "environmentFiles": env_state,
                  "needDaemonReload": first["NeedDaemonReload"],
                  "metadata": "ROOT_CONTROLLED_SINGLE_LINK", "process": "STABLE_ACROSS_TWO_READS",
                  "rawUnitExported": False, "serverWrites": False, "replayAllowed": False,
                  "historicalWrite": "UNKNOWN", "snapshot": "NON_ATOMIC_CURRENT_ONLY"}
        return c.validate_receipt(result, source_sha, run_id)
    finally:
        os.close(fd)


def main():
    def stop(*_):
        raise c.Block("DEADLINE")
    try:
        c.require(len(sys.argv) == 3, "ARGS")
        signal.signal(signal.SIGALRM, stop)
        signal.alarm(35)
        result = observe(sys.argv[1], sys.argv[2])
        print(json.dumps(result, sort_keys=True))
        return 0
    except BaseException as e:
        reason = e.args[0] if type(e) is c.Block and len(e.args) == 1 and type(e.args[0]) is str else "UNKNOWN"
        if reason not in c.REASONS:
            reason = "UNKNOWN"
        print(json.dumps({"status": "C4_UNIT_BLOCK_" + reason}))
        return 2
    finally:
        signal.alarm(0)


if __name__ == "__main__":
    raise SystemExit(main())
