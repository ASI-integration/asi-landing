"""Deterministic witness acquisition races; no host or service reads."""
import json
import unittest
from contextlib import ExitStack
from unittest.mock import patch

import beget_g2_operator_witness as w


class WitnessRaceTests(unittest.TestCase):
    def setUp(self):
        self.policy = dict(release='b' * 40, unitHash='c' * 64, pid=46657,
                           invocation='a' * 32, crm='op@example.invalid',
                           ops='op@example.invalid')
        self.identity = dict(host=w.HOST, unit=w.UNIT, **{
            key: self.policy[key] for key in ('release', 'unitHash', 'pid', 'invocation')})
        self.raw = b''.join(f'{k}={v}'.encode() + b'\0' for k, v in
                           dict(w.FLAGS, CRM_OPERATOR_EMAILS=self.policy['crm'],
                                OPS_ADMIN_EMAILS=self.policy['ops']).items())
        stack = self.enterContext(ExitStack())
        for obj, name, value in ((w.sys, 'argv', ['witness']),):
            stack.enter_context(patch.object(obj, name, value))
        stack.enter_context(patch.dict(w.os.environ, {}, clear=True))
        stack.enter_context(patch.object(w.os, 'geteuid', return_value=0))
        uname = stack.enter_context(patch.object(w.os, 'uname'))
        uname.return_value.nodename = w.HOST
        self.policy_read = stack.enter_context(patch.object(
            w, 'trusted_file', return_value=json.dumps(self.policy)))
        self.snapshot = stack.enter_context(patch.object(
            w, 'snapshot', return_value=self.identity.copy()))
        self.opened = stack.enter_context(patch.object(w.os, 'open', return_value=91))
        stack.enter_context(patch.object(w.os, 'read', return_value=self.raw))
        self.reread = stack.enter_context(patch.object(w.os, 'pread', return_value=self.raw))
        self.closed = stack.enter_context(patch.object(w.os, 'close'))

    def test_stable_acquisition_control(self):
        receipt = w.observe()
        self.assertEqual(w.validate_receipt(receipt, self.policy), receipt)
        self.assertEqual(self.snapshot.call_count, 2)
        self.reread.assert_called_once_with(91, 131073, 0)
        self.closed.assert_called_once_with(91)
        self.assertEqual(self.policy_read.call_count, 2)

    def test_each_identity_change_in_both_acquisition_orders(self):
        changes = dict(host='other', unit='other.service', release='d' * 40,
                       unitHash='e' * 64, pid=46658, invocation='f' * 32)
        for key, value in changes.items():
            changed = self.identity | {key: value}
            for before, after in ((self.identity, changed), (changed, self.identity)):
                with self.subTest(key=key, changed_first=before == changed):
                    self.snapshot.side_effect = [before, after]
                    self.opened.reset_mock()
                    self.closed.reset_mock()
                    reason = 'PIN' if before == changed and key in ('pid', 'invocation') else 'IDENTITY_OR_RACE'
                    with self.assertRaisesRegex(w.Block, '^' + reason + '$'):
                        w.observe()
                    if reason == 'PIN':
                        self.opened.assert_not_called()
                        self.closed.assert_not_called()
                    else:
                        self.closed.assert_called_once_with(91)

    def test_environment_reread_conflict_precedes_second_snapshot(self):
        self.reread.return_value = self.raw.replace(b'op@example.invalid', b'xx@example.invalid')
        with self.assertRaisesRegex(w.Block, '^ENV_RACE$'):
            w.observe()
        self.assertEqual(self.snapshot.call_count, 1)
        self.assertEqual(self.policy_read.call_count, 1)
        self.closed.assert_called_once_with(91)

    def test_policy_change_after_observation_rejected(self):
        self.policy_read.side_effect = [json.dumps(self.policy),
                                       json.dumps(self.policy | {'invocation': 'f' * 32})]
        with self.assertRaisesRegex(w.Block, '^POLICY_RACE$'):
            w.observe()
        self.assertEqual(self.snapshot.call_count, 2)
        self.closed.assert_called_once_with(91)

    def test_old_receipt_cannot_replay_against_each_new_identity(self):
        receipt = w.observe()
        for key, value in dict(pid=46658, invocation='f' * 32,
                               release='d' * 40, unitHash='e' * 64).items():
            with self.subTest(key=key):
                policy = self.policy | {key: value}
                identity = self.identity | {key: value}
                control = w.evaluate(identity, identity, w.selected_env(self.raw), policy)
                self.assertEqual(w.validate_receipt(control, policy), control)
                with self.assertRaisesRegex(w.Block, '^RECEIPT$'):
                    w.validate_receipt(receipt, policy)


if __name__ == '__main__':
    unittest.main()
