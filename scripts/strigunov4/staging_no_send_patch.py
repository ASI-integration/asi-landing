"""Prepare a single no-send flag addition without exposing other staging settings.

Pure byte transformation: no filesystem, subprocess, environment, credentials,
network, or SQL calls. This module does NOT authorize a staging mutation.
"""
import hashlib
import re

FLAG = b"ASI_SYNTHETIC_NO_SEND=YES\n"
KEY = b"ASI_SYNTHETIC_NO_SEND"
KEY_LINE = re.compile(rb"^[ \t]*(?:export[ \t]+)?" + KEY + rb"(?:[ \t]*=|[ \t]|$)")
EXPECTED_OTHER = (
    b"EMAIL_AUTO_SEND", b"EMAIL_DRAFT_ONLY", b"DRY_RUN_TELEGRAM_OUTBOUND",
    b"ALLOW_REAL_TELEGRAM_SYNTHETIC", b"YOOKASSA_ENABLED", b"ASI_APP_ROOT",
)

class Block(ValueError):
    pass


def plan(raw):
    """Return exact original/appended bytes and nonsecret digest evidence.

    Every other byte is preserved. Refuse duplicate/conflicting flag entries,
    malformed end-of-file, attempts to smuggle a multiline continuation, or
    implausibly large/malformed environment-file data.
    """
    if type(raw) is not bytes or not 1 <= len(raw) <= 131072:
        raise Block("INVALID_FILE_SIZE")
    if b"\0" in raw or b"\r" in raw or not raw.endswith(b"\n"):
        raise Block("UNSAFE_FILE_FORMAT")
    lines = raw.splitlines(keepends=True)
    if not lines or len(lines) > 2500:
        raise Block("UNSAFE_LINE_COUNT")
    last_nonempty = next((line for line in reversed(lines) if line.strip()), b"")
    tail = last_nonempty.rstrip()
    slash_count = len(tail) - len(tail.rstrip(b"\\"))
    if slash_count % 2:
        raise Block("UNTERMINATED_CONTINUATION")
    entries = []
    for line in lines:
        stripped = line.strip()
        if stripped.startswith(b"#"):
            continue
        if KEY_LINE.match(line):
            entries.append(stripped)
    if len(entries) > 1:
        raise Block("DUPLICATE_SAFETY_FLAG")
    if entries:
        if entries[0] != FLAG.rstrip(b"\n"):
            raise Block("CONFLICTING_SAFETY_FLAG")
        output = raw
        changed = False
    else:
        output = raw + FLAG
        changed = True
    if not output.startswith(raw) or (output[len(raw):] not in (b"", FLAG)):
        raise Block("UNEXPECTED_BYTES_CHANGED")
    return {
        "changed": changed,
        "input_sha256": hashlib.sha256(raw).hexdigest(),
        "output_sha256": hashlib.sha256(output).hexdigest(),
        "bytes_written": len(output) - len(raw),
        "output": output,
    }
