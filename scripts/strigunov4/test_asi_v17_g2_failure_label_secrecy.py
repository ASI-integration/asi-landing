"""Synthetic regressions for the source-owned failure-label boundary."""
import unittest

import c4_operator_host as host


class HostileValue:
    def __str__(self):
        raise AssertionError("exception argument was formatted")

    def __repr__(self):
        raise AssertionError("exception argument was represented")

    def __hash__(self):
        raise AssertionError("exception argument was hashed")

    def __eq__(self, other):
        raise AssertionError("exception argument was compared")


class FailureLabelSecrecyTests(unittest.TestCase):
    def assert_unknown(self, error):
        self.assertEqual(host.failure_code(error), "BLOCK_REASON_UNKNOWN")

    def test_every_allowlisted_exact_block_emits_its_bounded_label(self):
        self.assertTrue(host.REASONS)
        for reason in sorted(host.REASONS):
            with self.subTest(reason=reason):
                label = host.failure_code(host.Block(reason))
                self.assertEqual(label, "BLOCK_REASON_" + reason)
                self.assertIs(type(label), str)
                self.assertIn(label, host.BLOCKS)
                self.assertRegex(label, r"\ABLOCK_REASON_[A-Z_]+\Z")

    def test_block_subclasses_cannot_emit_even_allowlisted_reasons(self):
        class Child(host.Block):
            def __str__(self):
                raise AssertionError("subclass message was formatted")

        class HostileChild(Child):
            def __getattribute__(self, name):
                if name == "args":
                    raise AssertionError("subclass arguments were inspected")
                return super().__getattribute__(name)

        for kind in (Child, HostileChild):
            for reason in sorted(host.REASONS):
                with self.subTest(kind=kind.__name__, reason=reason):
                    self.assert_unknown(kind(reason))

    def test_unrelated_exceptions_do_not_expose_messages(self):
        class HostileError(Exception):
            def __str__(self):
                raise AssertionError("exception message was formatted")

            def __repr__(self):
                raise AssertionError("exception was represented")

        for kind in (Exception, ValueError, OSError, HostileError):
            for value in ("HOST", "synthetic-private-message\nHOST", HostileValue()):
                with self.subTest(kind=kind.__name__):
                    self.assert_unknown(kind(value))

    def test_zero_or_multiple_arguments_never_emit_a_reason(self):
        self.assert_unknown(host.Block())
        for reason in sorted(host.REASONS):
            for extra in ("synthetic-private-message", HostileValue()):
                with self.subTest(reason=reason):
                    self.assert_unknown(host.Block(reason, extra))
                    self.assert_unknown(host.Block(extra, reason))

    def test_non_string_arguments_are_not_coerced_or_compared(self):
        for value in (None, True, 1, b"HOST", ["HOST"], {"HOST": 1},
                      HostileValue()):
            self.assert_unknown(host.Block(value))

    def test_string_subclass_cannot_impersonate_an_allowlisted_string(self):
        class HostileString(str):
            __str__ = HostileValue.__str__
            __repr__ = HostileValue.__repr__
            __hash__ = HostileValue.__hash__
            __eq__ = HostileValue.__eq__

        for reason in sorted(host.REASONS):
            with self.subTest(reason=reason):
                self.assert_unknown(host.Block(HostileString(reason)))

    def test_unknown_and_hostile_strings_never_escape(self):
        for value in ("", "UNKNOWN", "BLOCK_REASON_HOST", "host", " HOST",
                      "HOST ", "HOST\nsynthetic-private-message", "HOST\x00",
                      "HOST\r\n", "ＨＯＳＴ", "synthetic-private-" * 10000):
            self.assert_unknown(host.Block(value))


if __name__ == "__main__":
    unittest.main()
