"""Pure, fail-closed addition of one fixed synthetic operator; no host access."""
import re

from staging_no_send_patch import Block

OPERATOR = "c4-pilot-dc194ac7e5864f7abd2752fe743a89b7@asi.local"
KEYS = ("CRM_OPERATOR_EMAILS", "OPS_ADMIN_EMAILS")
SAFETY = {
    "EMAIL_AUTO_SEND": "false", "EMAIL_DRAFT_ONLY": "true",
    "DRY_RUN_TELEGRAM_OUTBOUND": "true", "ALLOW_REAL_TELEGRAM_SYNTHETIC": "false",
    "YOOKASSA_ENABLED": "false", "ASI_SYNTHETIC_NO_SEND": "YES",
    "ASI_APP_ROOT": "/var/www/asi-staging/current",
}
EMAIL = re.compile(r"[A-Za-z0-9.!#$%&'*+/=?^_`{|}~-]+@[A-Za-z0-9.-]+\Z")
ASSIGNMENT = re.compile(r"([A-Za-z_][A-Za-z0-9_]*)=(.*)\Z")


def require(ok, code):
    if not ok:
        raise Block(code)


def members(value):
    """Normalize membership without accepting quoting, escapes or wildcards."""
    require(type(value) is str and len(value) <= 16384, "ALLOWLIST_SIZE")
    tokens = [x for x in re.split(r"[,;\s]+", value) if x]
    require(all(EMAIL.fullmatch(x) and "*" not in x for x in tokens), "ALLOWLIST_FORMAT")
    result = []
    for token in tokens:
        if token.lower() not in [x.lower() for x in result]:
            result.append(token)
    return result


def decode(raw):
    """Accept only single-line EnvironmentFile assignments, never continuation."""
    require(type(raw) is bytes and 0 < len(raw) <= 131072, "ENV_SIZE")
    require(raw.endswith(b"\n") and b"\r" not in raw and b"\0" not in raw, "ENV_FORMAT")
    try:
        text = raw.decode("utf-8", "strict")
    except UnicodeError:
        raise Block("ENV_ENCODING") from None
    values, positions = {}, {}
    lines = text.splitlines(keepends=True)
    require(len(lines) <= 2500, "ENV_LINES")
    for index, line in enumerate(lines):
        stripped = line.strip()
        if not stripped or stripped.startswith(("#", ";")):
            continue
        match = ASSIGNMENT.fullmatch(stripped)
        require(match is not None, "ENV_ASSIGNMENT")
        key, value = match.groups()
        # Reject all multiline/escape syntax, even on unrelated keys. A target
        # line must never be interpreted as part of a previous assignment.
        require("\\" not in value, "ENV_ESCAPE")
        if value.startswith(("'", '"')):
            require(len(value) >= 2 and value[-1] == value[0]
                    and value[0] not in value[1:-1], "ENV_QUOTING")
            value = value[1:-1]
        else:
            require("'" not in value and '"' not in value, "ENV_QUOTING")
        if key in (*KEYS, *SAFETY):
            require(key not in values, "DUPLICATE_TARGET_OR_SAFETY")
            values[key], positions[key] = value, index
    require(all(values.get(k) == v for k, v in SAFETY.items()), "FILE_NO_SEND")
    return lines, values, positions


def plan(raw):
    """Preserve unrelated bytes and existing members; idempotent planning only."""
    lines, values, positions = decode(raw)
    before, after = {}, {}
    changed = 0
    for key in KEYS:
        tokens = members(values.get(key, ""))
        before[key] = {x.lower() for x in tokens}
        if OPERATOR not in before[key]:
            tokens.append(OPERATOR)
        after[key] = {x.lower() for x in tokens}
        canonical = key + '="' + ",".join(tokens) + '"\n'
        if key in positions:
            old = lines[positions[key]]
            # Avoid rewriting already valid, unique, unchanged lists.
            raw_tokens = [x for x in re.split(r"[,;\s]+", values[key]) if x]
            if before[key] == after[key] and len(raw_tokens) == len(tokens):
                continue
            lines[positions[key]] = canonical
            changed += old != canonical
        else:
            lines.append(canonical)
            changed += 1
    output = "".join(lines).encode("utf-8")
    require(all(after[k] == before[k] | {OPERATOR} for k in KEYS), "MEMBERSHIP_DELTA")
    return {"output": output, "changed": output != raw,
            "changedLists": changed, "before": before, "after": after}
