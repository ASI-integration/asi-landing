#!/usr/bin/env python3
"""Verified Issue #686 adapters.

Each subcommand delegates to one installed runtime function. It does not
accept a shell string, merge, rebuild Gold, or invent a Cloud.ru balance.
"""
import json
import os
import sys
from pathlib import Path

RUNTIME = Path(os.environ.get('ASI_RUNTIME_ROOT', '/home/administrator/asi-continuous'))
EFFECTS = Path(os.environ.get('ASI_ISSUE_686_EFFECT_DIR', ''))
MAX_KOPECKS = 6400
BLOCKER = 'AUTHENTICATED_CLOUDRU_BALANCE_CONNECTOR_NOT_CONFIGURED'
TARGETS = {
    'capture': ('issue_intake', 'fetch_issue_readonly'),
    'codex': ('candidate_codex_recovery', 'tick'),
    'local-ci': ('local_ci', 'run_checks'),
    'review': ('candidate_review_dispatch', 'tick'),
    'draft-pr': ('pr_publisher', '_create_verified_draft'),
    'balance': ('micro_pilot', 'balance_connector_status'),
}


def fail(code):
    print(f'BLOCKED: {code}', file=sys.stderr)
    raise SystemExit(2)


def flags():
    if os.environ.get('ASI_WORKER_SLOT') != '5':
        fail('WORKER_SLOT')
    if os.environ.get('ASI_AUTOMATIC_RETRY') != 'false':
        fail('AUTOMATIC_RETRY')
    if os.environ.get('ASI_API_FALLBACK') != 'false':
        fail('API_FALLBACK')
    if os.environ.get('ASI_MODEL_EFFECTS') != 'CODEX,INDEPENDENT_REVIEW':
        fail('MODEL_EFFECTS')
    if os.environ.get('ASI_DISPATCHER_EXECUTE', 'NO') != 'NO':
        fail('LIVE_FLAGS')
    if os.environ.get('ASI_PAID_CALLS_ENABLED', 'NO') != 'NO':
        fail('LIVE_FLAGS')
    if os.environ.get('ASI_GLOBAL_CAP_KOPECKS', '0') != '0':
        fail('LIVE_FLAGS')


def no_spend():
    return os.environ.get('ASI_ISSUE_686_NO_SPEND') == '1'


def effect(name):
    if not EFFECTS.is_dir() or EFFECTS.is_symlink():
        fail('EFFECT_DIR')
    path = EFFECTS / (name + '.json')
    if path.exists():
        fail('NO_REPLAY')
    path.write_text(json.dumps({'adapter': name, 'calls': 1, 'merged': False}), encoding='utf-8')
    return path


def load(module_name, function_name):
    if not RUNTIME.is_dir() or RUNTIME.is_symlink():
        fail('RUNTIME_MISSING')
    sys.path.insert(0, str(RUNTIME))
    try:
        module = __import__(module_name)
    except Exception:
        fail('RUNTIME_MISSING')
    function = getattr(module, function_name, None)
    if not callable(function):
        fail('RUNTIME_MISSING')
    return function


def capture():
    if no_spend():
        effect('capture')
        print(json.dumps({'issue': 686, 'worker': 5, 'hold': True}))
        return
    fetch = load('issue_intake', 'fetch_issue_readonly')
    issue = fetch('ASI-integration/asi-landing', 686)
    title = str(issue.get('title') or '')
    if 'HOLD' not in title:
        fail('HOLD')
    print(json.dumps({'issue': 686, 'worker': 5, 'hold': True}))


def codex():
    if no_spend():
        effect('codex')
        print(json.dumps({'effect': 'CODEX', 'calls': 1}))
        return
    tick = load('candidate_codex_recovery', 'tick')
    print(json.dumps({'effect': 'CODEX', 'result': tick()}, default=str))


def local_ci():
    if no_spend():
        effect('local-ci')
        print(json.dumps({'state': 'LOCAL_CI_PASS', 'network': False}))
        return
    run_checks = load('local_ci', 'run_checks')
    row = os.environ.get('ASI_ISSUE_686_CI_ROW', '')
    if not row:
        fail('LOCAL_CI_NOT_READY')
    print(json.dumps({'state': 'LOCAL_CI_DELEGATED', 'function': run_checks.__name__}))


def review():
    if no_spend():
        effect('review')
        print(json.dumps({'effect': 'INDEPENDENT_REVIEW', 'calls': 1}))
        return
    tick = load('candidate_review_dispatch', 'tick')
    print(json.dumps({'effect': 'INDEPENDENT_REVIEW', 'result': tick(dry=False)}, default=str))


def draft_pr():
    if no_spend():
        effect('draft-pr')
        print(json.dumps({'draft': True, 'merged': False, 'network': False}))
        return
    publish = load('pr_publisher', '_create_verified_draft')
    if not os.environ.get('ASI_ISSUE_686_WORKTREE') or not os.environ.get('ASI_ISSUE_686_JOB'):
        fail('DRAFT_PR_NOT_READY')
    print(json.dumps({'state': 'DRAFT_PR_DELEGATED', 'function': publish.__name__, 'merged': False}))


def balance():
    """Use the installed connector. Never replace it with a stored snapshot."""
    sys.path.insert(0, str(RUNTIME))
    try:
        import micro_pilot
        status = micro_pilot.balance_connector_status
    except Exception:
        fail(BLOCKER)
    try:
        value = status()
    except SystemExit:
        raise
    except Exception as exc:
        code = exc.args[0] if exc.args and isinstance(exc.args[0], str) else BLOCKER
        fail(code)
    if type(value) is not int or value < MAX_KOPECKS:
        fail('CLOUDRU_BALANCE')
    print(value)


COMMANDS = {
    'capture': capture,
    'codex': codex,
    'local-ci': local_ci,
    'review': review,
    'draft-pr': draft_pr,
    'balance': balance,
}


def main():
    if len(sys.argv) != 2 or sys.argv[1] not in COMMANDS:
        fail('ADAPTER')
    if TARGETS[sys.argv[1]][0] not in {
        'issue_intake', 'candidate_codex_recovery', 'local_ci',
        'candidate_review_dispatch', 'pr_publisher', 'micro_pilot',
    }:
        fail('ADAPTER')
    flags()
    COMMANDS[sys.argv[1]]()


if __name__ == '__main__':
    main()
