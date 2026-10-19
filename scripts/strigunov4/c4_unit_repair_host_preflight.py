"""Staging-specific read-only host preflight for a future C4 unit repair.

This is not an executable repair or a source of permission. It never writes
systemd units, calls daemon-reload, restarts a service or contacts a database.
A separate reviewed manager-wide isolation proof is required before mutation.
No caller-controlled path, unit name, host or expected unit hash is supported.
"""
import hashlib
import http.client
import json
import os
from pathlib import Path
import time

import c4_operator_patch as operator
import c4_unit_contract as c
import c4_unit_readonly as unit_reader
import c4_unit_repair_phase_contract as phase
import staging_no_send_host as io

ROOT = Path("/var/www/asi-staging")
CURRENT = ROOT / "current"
EXPECTED_RELEASE = ROOT / "releases" / "d912aec6663de90e5ca4293cc5a69e2e0ed9ff94"
HOST = "asi-agent-runner"
HTTP_PORT = 3001
HEALTH_ENDPOINTS = ("health", "version")
PROCESS_KEYS = ("MainPID", "InvocationID", "ExecMainStartTimestampMonotonic")


def require_deadline(deadline):
    """Bound every read/GET under one monotonic deadline."""
    remaining = deadline - time.monotonic()
    c.require(remaining > 0.05, "DEADLINE")
    return remaining


def effective_safety(raw):
    """Inspect only the seven exact no-send keys, never export process secrets."""
    c.require(type(raw) is bytes and 0 < len(raw) <= 262144 and raw.endswith(b"\0"), "IDENTITY")
    values = {}
    for entry in raw.split(b"\0")[:-1]:
        if b"=" not in entry:
            continue
        key, value = entry.split(b"=", 1)
        if key not in {x.encode() for x in operator.SAFETY}:
            continue
        label = key.decode("ascii")
        c.require(label not in values, "IDENTITY")
        values[label] = value.decode("utf-8", "strict")
    c.require(values == operator.SAFETY, "IDENTITY")
    return True


def process_env(pid, deadline):
    """Bound a kernel process-environment read; never return those contents."""
    require_deadline(deadline)
    c.require(type(pid) is str and pid.isdecimal() and int(pid) > 1, "IDENTITY")
    path = Path("/proc") / pid / "environ"
    fd = os.open(path, os.O_RDONLY | getattr(os, "O_NOFOLLOW", 0) | getattr(os, "O_NONBLOCK", 0))
    try:
        # procfs content has no reliable st_size; consume to EOF within the
        # fixed bound rather than trusting a single possibly partial read.
        chunks, total = [], 0
        while total <= 262144:
            part = os.read(fd, min(16384, 262145 - total))
            if not part:
                break
            chunks.append(part)
            total += len(part)
        c.require(total <= 262144, "SIZE")
        return effective_safety(b"".join(chunks))
    finally:
        os.close(fd)


def check_health(deadline):
    """GET only fixed loopback health/version after effective no-send proof."""
    for endpoint in HEALTH_ENDPOINTS:
        conn = http.client.HTTPConnection("127.0.0.1", HTTP_PORT,
                                          timeout=min(5, require_deadline(deadline)))
        try:
            conn.request("GET", "/api/" + endpoint)
            reply = conn.getresponse()
            c.require(reply.status == 200, "IDENTITY")
            raw = reply.read(65537)
            c.require(len(raw) <= 65536, "SIZE")
            value = json.loads(raw)
            c.require(type(value) is dict, "IDENTITY")
            if endpoint == "health":
                c.require(value.get("ok") is True, "IDENTITY")
            else:
                c.require(value.get("sha") == EXPECTED_RELEASE.name
                          and value.get("environment") == "staging"
                          and value.get("resolvedReleasePath") == str(EXPECTED_RELEASE),
                          "IDENTITY")
        finally:
            conn.close()
    return True


def unit_phase(raw, state):
    """Accept independent OLD+optional before, and exact NEW+mandatory after."""
    c.require(state in ("OLD", "NEW"), "ARGS")
    expected = phase.OLD if state == "OLD" else phase.NEW
    proposal = c.plan(raw, expected_old=expected)
    c.require(proposal["beforeSha256"] == expected, "OLD_HASH")
    c.require((proposal["removedBytes"] == 1 if state == "OLD" else
               proposal["removedBytes"] == 0), "VALUE")
    c.require(proposal["afterSha256"] == phase.NEW, "VALUE")
    return proposal


def manager_phase(props, stage):
    """Validate loaded manager identity and strict phase-specific env contract."""
    c.require(stage in ("OLD", "NEW"), "ARGS")
    env_state = unit_reader.identity(props)
    expect = "EXACT_EXPECTED_OPTIONAL" if stage == "OLD" else "EXACT_EXPECTED"
    c.require(env_state == expect and props["NeedDaemonReload"] == "no", "IDENTITY")
    return props


def process_identity(props):
    """Hash stable PID/invocation/start identity without printing raw values."""
    c.require(all(type(props[k]) is str for k in PROCESS_KEYS), "IDENTITY")
    return hashlib.sha256("\0".join(props[k] for k in PROCESS_KEYS).encode("ascii")).hexdigest()


def host_identity():
    """Refuse unreviewed hosts and non-root contexts before examining state."""
    c.require(os.name == "posix" and os.geteuid() == 0
              and os.uname().nodename == HOST, "HOST")
    c.require(CURRENT.is_symlink() and CURRENT.resolve() == EXPECTED_RELEASE, "IDENTITY")


def fixed_observation(stage):
    """Read one exact staging unit and its process; refuse any drift.

    This supplies unit/process/no-send/health evidence, NOT isolation for the
    global systemd manager. No otherStateToken is issued here. Consequently
    this result cannot be passed to transaction.apply as an approval.
    """
    c.require(stage in ("OLD", "NEW"), "ARGS")
    host_identity()
    deadline = time.monotonic() + 30
    fd = c.open_parent("/etc/systemd/system")
    try:
        first, old_stat, old_attrs = c.read_regular(fd, "asi-landing-staging.service")
        proposal = unit_phase(first, stage)
        manager_before = manager_phase(unit_reader.properties(deadline), stage)
        process_env(manager_before["MainPID"], deadline)
        check_health(deadline)
        manager_after = manager_phase(unit_reader.properties(deadline), stage)
        process_env(manager_after["MainPID"], deadline)
        second, new_stat, new_attrs = c.read_regular(fd, "asi-landing-staging.service")
        c.require(first == second and c.signature(old_stat) == c.signature(new_stat)
                  and old_attrs == new_attrs, "READ_RACE")
        c.require(manager_before == manager_after
                  and process_identity(manager_before) == process_identity(manager_after), "PROCESS_CHANGED")
        # A directory fd might remain valid after its original pathname has
        # been swapped. Reopen the fixed chain and reject a changed identity.
        fresh_fd = c.open_parent("/etc/systemd/system")
        try:
            old_dir, current_dir = os.fstat(fd), os.fstat(fresh_fd)
            c.require((old_dir.st_dev, old_dir.st_ino) ==
                      (current_dir.st_dev, current_dir.st_ino), "READ_RACE")
        finally:
            os.close(fresh_fd)
        require_deadline(deadline)
        return {
            "unitSha256": proposal["beforeSha256"],
            "environmentFiles": "optional" if stage == "OLD" else "mandatory",
            "processToken": process_identity(manager_after),
            "noSend": True,
            "health": True,
            "otherStateToken": "NOT_PROVEN",
            "isolation": "MANAGER_WIDE_NOT_PROVEN",
            "snapshot": "NON_ATOMIC_CURRENT_ONLY",
        }
    finally:
        os.close(fd)


if __name__ == "__main__":
    raise SystemExit("HOST_READONLY_MODULE_ONLY_NO_SERVER_AUTHORITY")
