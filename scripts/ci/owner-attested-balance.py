#!/usr/bin/env python3
"""Owner-attested monetary balance for the single Issue #686 cycle.

This is not a Cloud.ru balance API result. Grant bonuses are recorded and
are never added to the monetary remainder.
"""
import hashlib
import json
import sqlite3
import sys
import time
from pathlib import Path

BUDGET = 6400
RESERVE = 3200
FLOOR = 81533
CALL_MAX = 3200
WINDOW = 600
EFFECTS = ('CODEX', 'INDEPENDENT_REVIEW')
PUBLIC_KEY = '/etc/asi/p1-686-owner-public.pem'


def fail(code):
    print(f'BLOCKED: {code}', file=sys.stderr)
    raise SystemExit(2)


def args(argv):
    out = {}
    index = 0
    while index < len(argv):
        item = argv[index]
        if item.startswith('--') and index + 1 < len(argv):
            out[item[2:]] = argv[index + 1]
            index += 2
        else:
            index += 1
    return out


def load_json(path):
    file_path = Path(path)
    if not file_path.is_file() or file_path.is_symlink():
        fail('ATTESTATION_MISSING')
    return json.loads(file_path.read_text(encoding='utf-8'))


def attestation(path):
    doc = load_json(path)
    if doc.get('kind') != 'OWNER_ATTESTED_BALANCE' or doc.get('source') != 'owner_cabinet':
        fail('ATTESTATION_KIND')
    if doc.get('apiBalance') is not False:
        fail('ATTESTATION_KIND')
    if doc.get('issue') != 686 or doc.get('worker') != 5:
        fail('ATTESTATION_SCOPE')
    if doc.get('budgetKopecks') != BUDGET or doc.get('reserveKopecks') != RESERVE:
        fail('ATTESTATION_SCOPE')
    money = doc.get('monetaryBalanceKopecks')
    bonus = doc.get('grantBonusKopecks')
    if type(money) is not int or money < 0 or type(bonus) is not int or bonus < 0:
        fail('ATTESTATION_AMOUNT')
    if type(doc.get('observedAt')) is not int:
        fail('ATTESTATION_EXPIRED')
    if not isinstance(doc.get('exactSha'), str) or not doc['exactSha']:
        fail('ATTESTATION_SHA')
    return doc


def gate_ok(path, attestation_sha):
    doc = load_json(path)
    if doc.get('status') != 'approved' or not isinstance(doc.get('authorization'), dict):
        fail('GATE_MISSING')
    auth = doc['authorization']
    if auth.get('source') != 'explicit_owner_message' or auth.get('owner') != 'Nikolay':
        fail('GATE_SCOPE')
    if 'OWNER_ATTESTED_BALANCE' not in auth.get('scope', ''):
        fail('GATE_SCOPE')
    record = doc.get('identity', {}).get('recordId', '')
    if f'attestation-sha256={attestation_sha}' not in record:
        fail('PERMIT_SHA')
    return doc


def ledger_zero(path):
    file_path = Path(path)
    if not file_path.is_file() or file_path.is_symlink():
        fail('LEDGER')
    with sqlite3.connect(file_path.resolve().as_uri() + '?mode=ro', uri=True) as db:
        row = db.execute('SELECT cap, paused FROM policy WHERE id=1').fetchone()
        calls = db.execute('SELECT count(*) FROM calls').fetchone()[0]
    if row is None or int(row[0]) != 0 or int(row[1]) != 0 or int(calls) != 0:
        fail('PARALLEL_PAID')


def state_path(options):
    return Path(options['state'])


def read_state(options):
    path = state_path(options)
    if not path.exists():
        return None
    if path.is_symlink():
        fail('ATTESTATION_REUSED')
    return json.loads(path.read_text(encoding='utf-8'))


def write_state(options, doc):
    path = state_path(options)
    path.parent.mkdir(parents=True, exist_ok=True)
    path.write_text(json.dumps(doc), encoding='utf-8')


def verify_ticket(options):
    ticket_path = Path(options['ticket'])
    signature_path = Path(options['signature'])
    if (not ticket_path.is_file() or ticket_path.is_symlink()
            or not signature_path.is_file() or signature_path.is_symlink()):
        fail('GATE_MISSING')
    runtime = Path(options['runtime'])
    sys.path.insert(0, str(runtime))
    import issue_intake
    ticket = json.loads(ticket_path.read_text(encoding='utf-8'))
    signature = signature_path.read_bytes()
    try:
        issue_intake.verify_signed_owner_ticket(
            ticket, signature, Path(options.get('public-key', PUBLIC_KEY)))
    except Exception as exc:
        code = str(exc).strip() or 'OWNER_SIGNATURE_REJECTED'
        fail(code)
    doc = attestation(options['attestation'])
    if ticket.get('base_sha') != options['exact-sha'] or doc['exactSha'] != options['exact-sha']:
        fail('ATTESTATION_SHA')
    if ticket.get('not_before') != doc['observedAt'] or ticket.get('expires_at') != doc['observedAt'] + WINDOW:
        fail('ATTESTATION_EXPIRED')
    permit = hashlib.sha256(Path(options['permit']).read_bytes()).hexdigest()
    if ticket.get('selfhosted_workflow_sha256') != permit:
        fail('PERMIT_SHA')
    consumed = Path(options['consumed'])
    if consumed.is_file() and not consumed.is_symlink():
        if str(ticket.get('owner_release_nonce')) in consumed.read_text(encoding='utf-8').split():
            fail('ATTESTATION_REUSED')
    if doc['monetaryBalanceKopecks'] < FLOOR:
        fail('INSUFFICIENT_FUNDS')
    return ticket


def consume_ticket(options):
    ticket_path = Path(options['ticket'])
    if not ticket_path.is_file() or ticket_path.is_symlink():
        return
    ticket = json.loads(ticket_path.read_text(encoding='utf-8'))
    nonce = str(ticket.get('owner_release_nonce', ''))
    if len(nonce) != 32:
        return
    consumed = Path(options['consumed'])
    consumed.parent.mkdir(mode=0o700, exist_ok=True)
    existing = consumed.read_text(encoding='utf-8') if consumed.is_file() else ''
    if nonce not in existing.split():
        consumed.write_text(existing + nonce + '\n', encoding='utf-8')


def admit_start(options):
    doc = attestation(options['attestation'])
    if options.get('ticket'):
        verify_ticket(options)
    else:
        gate_ok(options['gate'], options['attestation-sha256'])
    now = int(options.get('now', int(time.time())))
    age = now - doc['observedAt']
    if age < 0 or age > WINDOW:
        fail('ATTESTATION_EXPIRED')
    if doc['exactSha'] != options['exact-sha']:
        fail('ATTESTATION_SHA')
    if doc['monetaryBalanceKopecks'] < FLOOR or doc['monetaryBalanceKopecks'] < BUDGET + RESERVE:
        fail('INSUFFICIENT_FUNDS')
    if read_state(options) is not None:
        fail('ATTESTATION_REUSED')
    ledger_zero(options['ledger'])
    if options.get('paid') != 'NO' or options.get('execute') != 'NO':
        fail('PARALLEL_PAID')
    write_state(options, {
        'kind': 'OWNER_ATTESTED_BALANCE',
        'consumed': False,
        'monetaryBalanceKopecks': doc['monetaryBalanceKopecks'],
        'grantBonusKopecks': doc['grantBonusKopecks'],
        'reserved': [],
        'unknown': False,
    })
    print(json.dumps({
        'source': 'OWNER_ATTESTED_BALANCE',
        'apiBalance': False,
        'monetaryBalanceKopecks': doc['monetaryBalanceKopecks'],
        'grantBonusKopecks': doc['grantBonusKopecks'],
        'grantBonusesCountedAsMoney': False,
    }))


def admit_call(options):
    effect = options['effect']
    if effect not in EFFECTS:
        fail('MODEL_EFFECTS')
    state = read_state(options)
    if state is None or state.get('consumed') or state.get('unknown'):
        fail('ATTESTATION_REUSED')
    if effect in state['reserved'] or len(state['reserved']) >= len(EFFECTS):
        fail('NO_REPLAY')
    spent = CALL_MAX * len(state['reserved'])
    remaining_budget = BUDGET - spent
    remaining_money = state['monetaryBalanceKopecks'] - spent - RESERVE
    if remaining_budget < CALL_MAX or remaining_money < CALL_MAX:
        fail('CALL_COST')
    state['reserved'].append(effect)
    write_state(options, state)
    print(json.dumps({'source': 'OWNER_ATTESTED_BALANCE', 'effect': effect, 'maxKopecks': CALL_MAX}))


def observed_charges(ledger):
    file_path = Path(ledger)
    if not file_path.is_file() or file_path.is_symlink():
        return None
    with sqlite3.connect(file_path.resolve().as_uri() + '?mode=ro', uri=True) as db:
        columns = [item[1] for item in db.execute('PRAGMA table_info(calls)').fetchall()]
        known = [name for name in ('kopecks', 'cost_kopecks', 'amount_kopecks', 'charge_kopecks') if name in columns]
        if len(known) != 1:
            return None
        return [row[0] for row in db.execute(f'SELECT {known[0]} FROM calls ORDER BY id')]


def reconcile(options):
    state = read_state(options)
    if state is None or state.get('consumed') or state.get('unknown'):
        fail('ATTESTATION_REUSED')
    values = observed_charges(options['ledger'])
    uncertain = (
        values is None
        or len(values) != len(state['reserved'])
        or any(type(value) is not int or value < 0 or value > CALL_MAX for value in values)
    )
    if uncertain or sum(values) > BUDGET:
        state['unknown'] = True
        write_state(options, state)
        fail('UNKNOWN_CHARGE_STOP')
    state['consumed'] = True
    state['actualKopecks'] = sum(values)
    write_state(options, state)
    print(json.dumps({
        'source': 'OWNER_ATTESTED_BALANCE',
        'actualKopecks': sum(values),
        'apiBalance': False,
    }))


def main():
    if len(sys.argv) < 2:
        fail('ATTESTATION_MISSING')
    command = sys.argv[1]
    options = args(sys.argv[2:])
    if command == 'verify-ticket':
        verify_ticket(options)
        print('OWNER_TICKET_VERIFIED')
    elif command == 'consume-ticket':
        consume_ticket(options)
    elif command == 'admit-start':
        admit_start(options)
    elif command == 'admit-call':
        admit_call(options)
    elif command == 'reconcile':
        reconcile(options)
    else:
        fail('ATTESTATION_MISSING')


if __name__ == '__main__':
    main()
