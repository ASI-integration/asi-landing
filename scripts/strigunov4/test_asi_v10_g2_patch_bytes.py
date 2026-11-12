"""Offline byte-fidelity regressions; all host effects are simulated in memory."""
import unittest
from unittest.mock import patch

import c4_operator_host as host
import c4_operator_patch as p


def env(extra=b''):
    return b''.join(f'{k}={v}\n'.encode() for k, v in p.SAFETY.items()) + extra


def target(key, value):
    return f'{key}="{value}"\n'.encode()


class PatchBytesTests(unittest.TestCase):
    def test_exact_replacement_and_second_application(self):
        prefix = env('# пример  \n\t\n'.encode())
        middle = b'OTHER="CRM_OPERATOR_EMAILS=untouched"\n; marker\n'
        suffix = b'OPS_ADMIN_EMAILS_EXTRA=keep\n# end  \n'
        raw = (prefix + b" CRM_OPERATOR_EMAILS='Keep@example.test' \t\n"
               + middle + target(p.KEYS[1], p.OPERATOR.upper()) + suffix)
        expected = (prefix + target(p.KEYS[0], 'Keep@example.test,' + p.OPERATOR)
                    + middle + target(p.KEYS[1], p.OPERATOR.upper()) + suffix)
        first = p.plan(raw)
        self.assertEqual(first['output'], expected)
        self.assertEqual(first['changedLists'], 1)
        self.assertTrue(first['changed'])
        again = p.plan(expected)
        self.assertEqual(again['output'], expected)
        self.assertEqual(again['changedLists'], 0)
        self.assertFalse(again['changed'])
        self.assertEqual(again['before'], first['after'])
        self.assertEqual(again['after'], first['after'])

    def test_noncanonical_noop_preserves_exact_bytes(self):
        raw = env(b'# retained  \n' + b''.join(
            f"\t{k}='Keep@example.test; {p.OPERATOR.upper()}'  \t\n".encode()
            for k in p.KEYS))
        result = p.plan(raw)
        self.assertEqual(result['output'], raw)
        self.assertFalse(result['changed'])
        self.assertEqual(result['changedLists'], 0)

    def test_crlf_and_bare_cr_rejected_even_on_noop(self):
        raw = env(b''.join(target(k, p.OPERATOR) for k in p.KEYS))
        self.assertEqual(p.plan(raw)['output'], raw)
        for invalid in (raw.replace(b'\n', b'\r\n'),
                        raw.replace(b'\n', b'\r\n', 1), raw + b'# x\ry\n'):
            with self.subTest(raw=invalid):
                with self.assertRaisesRegex(p.Block, '^ENV_FORMAT$'):
                    p.plan(invalid)

    def test_duplicate_active_markers_block_even_identical_noop(self):
        raw = env(b''.join(target(k, p.OPERATOR) for k in p.KEYS))
        for key in (*p.KEYS, *p.SAFETY):
            value = p.SAFETY.get(key, p.OPERATOR)
            for line in (f'{key}={value}\n', f' \t{key}="{value}" \n'):
                with self.subTest(key=key, line=line):
                    with self.assertRaisesRegex(p.Block, '^DUPLICATE_TARGET_OR_SAFETY$'):
                        p.plan(raw + line.encode())

    def test_unicode_whitespace_cannot_disguise_assignment_boundaries(self):
        for space in ('\u00a0', '\u2003', '\u3000'):
            for line in (space + 'CRM_OPERATOR_EMAILS=a@example.test\n',
                         'EMAIL_AUTO_SEND=false' + space + '\n'):
                with self.subTest(line=line):
                    raw = env(line.encode()) if line.startswith(space) else env().replace(
                        b'EMAIL_AUTO_SEND=false\n', line.encode())
                    with self.assertRaises(p.Block):
                        p.plan(raw)
        # Unicode content inside an unrelated value remains byte-exact.
        raw = env('OTHER="значение\u00a0"\n'.encode())
        self.assertEqual(p.plan(raw)['output'], raw + b''.join(
            target(k, p.OPERATOR) for k in p.KEYS))

    def test_generated_output_must_remain_within_parser_byte_limit(self):
        base = env()
        raw = base + b'#' + b'x' * (131072 - len(base) - 2) + b'\n'
        self.assertEqual(len(raw), 131072)
        p.decode(raw)
        with self.assertRaisesRegex(p.Block, '^ENV_SIZE$'):
            p.plan(raw)

    def test_generated_output_must_remain_within_parser_line_limit(self):
        base = env()
        raw = base + b'#\n' * (2500 - base.count(b'\n'))
        p.decode(raw)
        with self.assertRaisesRegex(p.Block, '^ENV_LINES$'):
            p.plan(raw)

    def test_failed_activation_restores_original_exactly(self):
        original = env('OTHER="пример  "\n# retained\t\n'.encode()
                       + b" CRM_OPERATOR_EMAILS='Keep@example.test' \n")
        proposed = p.plan(original)['output']
        current = [original]
        writes = []
        metadata = object()

        def atomic(output, meta, expected):
            self.assertIs(meta, metadata)
            self.assertEqual(current[0], expected)
            writes.append((output, expected))
            current[0] = output

        # Two failures from the same restored baseline must restore the same bytes.
        for _ in range(2):
            with patch.object(host, 'live'), \
                    patch.object(host.io, 'read_env', side_effect=lambda: (current[0], metadata)), \
                    patch.object(host.io, 'atomic_env', side_effect=atomic), \
                    patch.object(host.io, 'write_private') as backup, \
                    patch.object(host.io, 'remaining'), \
                    patch.object(host, 'restart', side_effect=[RuntimeError('synthetic'), None]), \
                    patch.object(host, 'journal'), \
                    patch.object(host, 'sync_directory'), \
                    patch.object(host.Path, 'mkdir'):
                self.assertEqual(host.perform('123', 'a' * 40), {'status': 'ROLLBACK_PASS'})
                backup.assert_called_once_with(
                    host.EVIDENCE / host.CLAIM / 'original.env.private', original)
            self.assertEqual(current[0], original)
        self.assertEqual(writes, [(proposed, original), (original, proposed)] * 2)


if __name__ == '__main__':
    unittest.main()
