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
)
SERVICE = "asi-landing-staging.service"
FORBIDDEN_SERVICE = re.compile(r"(?:^|[-_.@])(?:sentinel|production|prod)(?:[-_.@]|$)", re.I)


def run_fixed(argv, deadline, max_bytes=65536):
    """Bound an exact read-only systemctl call with no inherited config."""
    remaining = deadline - time.monotonic()
    c.require(remaining > 0.05, "DEADLINE")
    c.require(argv in (
        ("systemctl", "list-jobs", "--no-legend", "--plain", "--no-pager"),
        ("systemctl", "list-units", "--all", "--type=service", "--no-legend",
         "--plain", "--no-pager"),
    ), "ARGS")
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


def service_inventory(raw):
    """Count services without exporting names; reject forbidden colocations."""
    c.require(type(raw) is str and len(raw) <= 65536, "SIZE")
    names = []
    for line in raw.splitlines():
        parts = line.split()
        if parts and parts[0] == "●":
            parts = parts[1:]
        c.require(len(parts) >= 4 and parts[0].endswith(".service"), "FORMAT")
        names.append(parts[0])
        c.require(len(names) <= 1000, "SIZE")
    c.require(len(names) == len(set(names)) and SERVICE in names, "IDENTITY")
    c.require(not any(name == "asi-landing.service" or
                      FORBIDDEN_SERVICE.search(name) for name in names), "IDENTITY")
    return len(names)


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
    preflight.fixed_observation("OLD")
    deadline = time.monotonic() + 30
    jobs_raw = run_fixed(("systemctl", "list-jobs", "--no-legend", "--plain",
                          "--no-pager"), deadline, 16384)
    jobs_state = "NONE_OBSERVED" if not jobs_raw.strip() else "PRESENT"
    service_raw = run_fixed(("systemctl", "list-units", "--all",
                             "--type=service", "--no-legend", "--plain",
                             "--no-pager"), deadline)
    try:
        count = service_inventory(service_raw)
        service_state = "NO_FORBIDDEN_SERVICE_OBSERVED"
    except c.Block:
        # Still preserve the one-shot diagnostic artifact, never promote a
        # malformed/unsafe service list to a safe result.
        count, service_state = 0, "CONFLICT_OR_UNKNOWN"
    generators = generator_inventory()
    return {
        "status": "READONLY_MANAGER_SURVEY",
        "unit": "OLD_OPTIONAL_PREFLIGHT_PASS",
        "servicesSeen": count,
        "services": service_state,
        "jobs": jobs_state,
        "generators": generators,
        "isolation": "MANAGER_WIDE_NOT_PROVEN",
        "daemonReloadAuthorized": False,
        "snapshot": "NON_ATOMIC_CURRENT_ONLY",
    }


if __name__ == "__main__":
    raise SystemExit("READONLY_SURVEY_LIBRARY_ONLY_NO_HOST_ACTION")
