"""Offline S4-G2 byte and membership regressions against the real planner."""
import unittest

import c4_operator_patch as patcher


def synthetic_env(extra=b""):
    return b"".join(f"{key}={value}\n".encode()
                    for key, value in patcher.SAFETY.items()) + extra


def canonical(key, *members):
    return (key + '="' + ",".join(members) + '"\n').encode()


class PatchInvariantTests(unittest.TestCase):
    def test_replacements_preserve_every_unrelated_byte_and_position(self):
        prefix = synthetic_env('# синтетический пример\n\t\n'.encode())
        middle = (b'; CRM_OPERATOR_EMAILS=A@example.test\n'
                  b'OTHER="A@example.test; OPS_ADMIN_EMAILS=unchanged"\n')
        suffix = b'CRM_OPERATOR_EMAILS_EXTRA=A@example.test\n# final comment  \n'
        raw = (prefix + b" CRM_OPERATOR_EMAILS='A@example.test; B@example.test' \n"
               + middle + b'\tOPS_ADMIN_EMAILS=Ops@example.test\t\n' + suffix)
        expected = (prefix + canonical(patcher.KEYS[0], 'A@example.test',
                                      'B@example.test', patcher.OPERATOR)
                    + middle + canonical(patcher.KEYS[1], 'Ops@example.test',
                                         patcher.OPERATOR) + suffix)
        result = patcher.plan(raw)
        self.assertEqual(result['output'], expected)
        self.assertTrue(result['changed'])
        self.assertEqual(result['changedLists'], 2)
        self.assertEqual(result['before'], {
            patcher.KEYS[0]: {'a@example.test', 'b@example.test'},
            patcher.KEYS[1]: {'ops@example.test'},
        })
        self.assertEqual(result['after'], {
            key: values | {patcher.OPERATOR}
            for key, values in result['before'].items()
        })

    def test_absent_lists_append_without_rewriting_lookalikes(self):
        raw = synthetic_env(b'# CRM_OPERATOR_EMAILS=comment@example.test\n'
                            b'OPS_ADMIN_EMAILS_SUFFIX=other@example.test\n\n')
        result = patcher.plan(raw)
        self.assertEqual(result['output'], raw + b''.join(
            canonical(key, patcher.OPERATOR) for key in patcher.KEYS))
        self.assertEqual(result['before'], dict.fromkeys(patcher.KEYS, set()))
        self.assertEqual(result['changedLists'], 2)

    def test_crlf_mixed_endings_and_bare_cr_fail_closed(self):
        raw = synthetic_env(b'CRM_OPERATOR_EMAILS=a@example.test\n')
        # Establish a valid control so rejection cannot be caused by the fixture.
        self.assertTrue(patcher.plan(raw)['changed'])
        for invalid in (raw.replace(b'\n', b'\r\n'),
                        raw.replace(b'\n', b'\r\n', 1),
                        raw + b'OTHER=a\rb\n'):
            with self.subTest(raw=invalid):
                with self.assertRaisesRegex(patcher.Block, '^ENV_FORMAT$'):
                    patcher.plan(invalid)

    def test_duplicate_active_targets_and_safety_markers_are_ambiguous(self):
        for key in (*patcher.KEYS, *patcher.SAFETY):
            value = patcher.SAFETY.get(key, 'a@example.test')
            first = f'{key}={value}\n'.encode()
            base = synthetic_env(first if key in patcher.KEYS else b'')
            self.assertTrue(patcher.plan(base)['changed'])
            for duplicate in (first, f'  {key}="{value}" \n'.encode()):
                with self.subTest(key=key, duplicate=duplicate):
                    with self.assertRaisesRegex(
                            patcher.Block, '^DUPLICATE_TARGET_OR_SAFETY$'):
                        patcher.plan(base + duplicate)

    def test_ambiguous_assignment_syntax_is_not_replaced(self):
        for line in (b'export CRM_OPERATOR_EMAILS=a@example.test\n',
                     b'CRM_OPERATOR_EMAILS =a@example.test\n',
                     b'CRM_OPERATOR_EMAILS a@example.test\n'):
            with self.subTest(line=line):
                with self.assertRaisesRegex(patcher.Block, '^ENV_ASSIGNMENT$'):
                    patcher.plan(synthetic_env(line))

    def test_each_list_state_converges_then_is_byte_idempotent(self):
        for present in ((), (patcher.KEYS[0],), (patcher.KEYS[1],), patcher.KEYS):
            with self.subTest(present=present):
                lines = []
                expected = []
                for key in patcher.KEYS:
                    members = ['Existing@example.test']
                    if key in present:
                        members.append(patcher.OPERATOR.upper())
                    lines.append((key + "='" + '; '.join(members) + "'  \n").encode())
                    expected.append(lines[-1] if key in present else canonical(
                        key, 'Existing@example.test', patcher.OPERATOR))
                raw = synthetic_env(b''.join(lines))
                first = patcher.plan(raw)
                self.assertEqual(first['output'], synthetic_env(b''.join(expected)))
                self.assertEqual(first['changedLists'], 2 - len(present))
                self.assertEqual(first['changed'], len(present) != 2)
                second = patcher.plan(first['output'])
                self.assertEqual(second['output'], first['output'])
                self.assertEqual(second['before'], first['after'])
                self.assertEqual(second['after'], first['after'])
                self.assertFalse(second['changed'])
                self.assertEqual(second['changedLists'], 0)

    def test_duplicate_case_members_are_removed_without_losing_original_spelling(self):
        raw = synthetic_env(b''.join(canonical(
            key, 'Keep@example.test', 'keep@EXAMPLE.test',
            patcher.OPERATOR.upper(), patcher.OPERATOR) for key in patcher.KEYS))
        result = patcher.plan(raw)
        expected = synthetic_env(b''.join(canonical(
            key, 'Keep@example.test', patcher.OPERATOR.upper()) for key in patcher.KEYS))
        self.assertEqual(result['output'], expected)
        self.assertEqual(result['changedLists'], 2)
        self.assertEqual(result['before'], result['after'])
        self.assertEqual(patcher.plan(expected)['changedLists'], 0)


if __name__ == '__main__':
    unittest.main()
