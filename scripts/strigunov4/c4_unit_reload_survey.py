"""Bounded read-only systemd-wide reload survey, never reload authority.

This module inspects only source-owned fixed service/manager command results and
generator-directory metadata. It never executes a generator, prints raw service
descriptions, changes unit files or calls systemctl daemon-reload.
Survey success is NOT proof that running generators would have no side effects.
"""
import os
from pathlib import Path
import re
import stat
import subprocess
import time

import c4_unit_contract as c
import c4_unit_repair_host_preflight as preflight

GENERATOR_DIRS = (
    "/etc/systemd/system-generators",
    "/run/systemd/system-generators",
    "/usr/local/lib/systemd/system-generators",
    "/usr/lib/systemd/system-generators",
    "/lib/systemd/system-generators",
    "/etc/systemd/system-environment-generators",
    "/run/systemd/system-environment-generators",
    "/usr/local/lib/systemd/system-environment-generators",
    "/usr/lib/systemd/system-environment-generators",
    "/lib/systemd/system-environment-generators",
)
SERVICE = "asi-landing-staging.service"
FORBIDDEN_SERVICE = re.compile(r"(?:^|[-_.@])(?:sentinel|production|prod)(?:[-_.@]|$)", re.I)
UNIT_TYPES = frozenset(("service", "socket", "target", "device", "mount",
                        "automount", "swap", "timer", "path", "slice", "scope"))
JOBS_COMMAND = ("systemctl", "list-jobs", "--no-legend", "--plain", "--no-pager")
UNITS_COMMAND = ("systemctl", "list-units", "--all", "--no-legend",
                 "--plain", "--no-pager", "--full")


def run_fixed(argv, deadline, max_bytes=65536):
    """Bound an exact read-only systemctl call with no inherited config."""
    remaining = deadline - time.monotonic()
    c.require(remaining > 0.05, "DEADLINE")
    c.require(argv in (JOBS_COMMAND, UNITS_COMMAND), "ARGS")
    try:
        result = subprocess.run(argv, capture_output=True,
                                timeout=min(8, remaining),
                                env={"PATH": "/usr/sbin:/usr/bin:/sbin:/bin", "LC_ALL": "C"})
    except (OSError, subprocess.TimeoutExpired):
        raise c.Block("COMMAND") from None
    c.require(result.returncode == 0 and len(result.stdout) <= max_bytes
              and len(result.stderr) <= 4096, "COMMAND")
    return result.stdout.decode("utf-8", "strict")


def jobs_quiet(raw):
    """Require zero pending manager jobs, including unfamiliar output formats."""
    c.require(type(raw) is str and len(raw) <= 16384, "SIZE")
    c.require(raw.strip() == "", "IDENTITY")
    return True


def unit_inventory(raw):
    """Inspect all loaded unit types, not installed/unloaded units or topology.

    Return only an internal canonical snapshot; never publish names. Absence
    of a forbidden name does not establish absence of a protected workload.
    """
    c.require(type(raw) is str and len(raw) <= 65536, "SIZE")
    names, states = [], []
    for line in raw.splitlines():
        parts = line.split()
        if parts and parts[0] == "●":
            parts = parts[1:]
        c.require(len(parts) >= 4 and parts[0].rsplit(".", 1)[-1] in UNIT_TYPES,
                  "FORMAT")
        c.require(parts[1] in ("loaded", "not-found", "bad-setting", "error", "masked")
                  and parts[2] in ("active", "inactive", "failed", "activating",
                                   "deactivating", "maintenance", "reloading", "refreshing"),
                  "FORMAT")
        names.append(parts[0])
        states.append(tuple(parts[:4]))
        c.require(len(names) <= 1000, "SIZE")
    c.require(len(names) == len(set(names)) and SERVICE in names, "IDENTITY")
    c.require(not any(name == "asi-landing.service" or
                      FORBIDDEN_SERVICE.search(name) for name in names), "IDENTITY")
    return tuple(sorted(states))


def generator_inventory(roots=GENERATOR_DIRS):
    """Inspect fixed generator directories; report a risk, never run code.

    Unknown symlinks, inaccessible locations or unexpected file types
    produce UNKNOWN, never an approval. Excessive entries block. Zero
    observed generators still does not prove unrelated units are safe.
    """
    c.require(type(roots) is tuple and bool(roots), "ARGS")
    total, unknown = 0, False
    for raw in roots:
        path = Path(raw)
        c.require(path.is_absolute(), "PATH")
        try:
            if not path.exists() and not path.is_symlink():
                continue
            # Typical Linux /lib aliases may be symlinks. Treat them as
            # UNKNOWN, not as proof of a harmless generator configuration;
            # one-shot read-only evidence should still be preserved.
            if path.is_symlink() or path.resolve() != path:
                unknown = True
                continue
            st = path.lstat()
            if (not stat.S_ISDIR(st.st_mode) or st.st_uid != 0
                    or st.st_mode & 0o022):
                unknown = True
                continue
            with os.scandir(path) as entries:
                for entry in entries:
                    info = entry.stat(follow_symlinks=False)
                    if (not stat.S_ISREG(info.st_mode) or info.st_uid != 0
                            or info.st_nlink != 1 or info.st_mode & 0o022):
                        unknown = True
                    total += 1
                    c.require(total <= 128, "SIZE")
        except (OSError, RuntimeError):
            unknown = True
    return "UNKNOWN" if unknown else "PRESENT" if total else "NONE_OBSERVED"


def survey():
    """Fixed read-only snapshot; always refuse to issue mutation authority."""
    preflight.host_identity()
    before = preflight.fixed_observation("OLD")
    deadline = time.monotonic() + 30
    jobs_before = run_fixed(JOBS_COMMAND, deadline, 16384)
    units_before = run_fixed(UNITS_COMMAND, deadline)
    generators = generator_inventory()
    units_after = run_fixed(UNITS_COMMAND, deadline)
    jobs_after = run_fixed(JOBS_COMMAND, deadline, 16384)
    jobs_state = "PRESENT" if jobs_before.strip() or jobs_after.strip() else "NONE_OBSERVED"
    try:
        first, second = unit_inventory(units_before), unit_inventory(units_after)
        count = len(second)
        unit_state = "NO_FORBIDDEN_UNIT_NAME_OBSERVED"
        stability = "SAME_LOADED_UNIT_STATES" if first == second else "DRIFT_OR_UNKNOWN"
    except c.Block:
        count, unit_state, stability = 0, "CONFLICT_OR_UNKNOWN", "DRIFT_OR_UNKNOWN"
    # A completed survey is only two observations. No lock on all writers,
    # generator inputs, unloaded units or the manager configuration is proven.
    c.require(before == preflight.fixed_observation("OLD"), "PROCESS_CHANGED")
    return {
        "status": "READONLY_MANAGER_SURVEY",
        "unit": "OLD_OPTIONAL_PREFLIGHT_PASS",
        "unitsSeen": count,
        "units": unit_state,
        "unitCoverage": "LOADED_ALL_TYPES_ONLY",
        "unitStability": stability,
        "generatorCoverage": "FIXED_SYSTEM_AND_ENVIRONMENT_DIRS_ONLY",
        "jobs": jobs_state,
        "generators": generators,
        "isolation": "MANAGER_WIDE_NOT_PROVEN",
        "daemonReloadAuthorized": False,
        "snapshot": "NON_ATOMIC_CURRENT_ONLY",
    }


if __name__ == "__main__":
    raise SystemExit("READONLY_SURVEY_LIBRARY_ONLY_NO_HOST_ACTION")
