"""Negative controls for the bounded C4 operator host error boundary."""

import unittest
from unittest.mock import patch

import c4_operator_host as host


EXPECTED_REASONS = frozenset(
    """
    ARGS RUN_BINDING HOST PARENT_IDENTITY UNIT SERVICE_IDENTITY ENVIRONMENT_FILES
    RELEASE PID DUPLICATE_EFFECTIVE_KEY EFFECTIVE_NO_SEND EFFECTIVE_MEMBERSHIP
    HEALTH_HTTP HEALTH_SIZE HEALTH_JSON HEALTH VERSION PID_CHANGED ALREADY_CONFIGURED
    CLAIM_EXISTS EVIDENCE LOCK ENV_SYMLINK ENV_IDENTITY ENV_SIZE ENV_READ_RACE
    ENV_FORMAT ENV_ENCODING ENV_CONTROL ENV_LINES ENV_ASSIGNMENT ENV_ESCAPE ENV_QUOTING
    DUPLICATE_TARGET_OR_SAFETY FILE_NO_SEND MEMBERSHIP_DELTA ALLOWLIST_SIZE
    ALLOWLIST_FORMAT COMMAND_UNAVAILABLE COMMAND_FAILED WORKER_DEADLINE_EXCEEDED
    DUPLICATE_SYSTEMD_PROPERTY
    """.split()
)
UNKNOWN = "BLOCK_REASON_UNKNOWN"
EXPECTED_CODES = frozenset({UNKNOWN, *("BLOCK_REASON_" + item for item in EXPECTED_REASONS)})
MAX_CODE_LENGTH = 64


class HostFailureCodeTests(unittest.TestCase):
    def assert_bounded_code(self, value):
        self.assertIs(type(value), str)
        self.assertIn(value, EXPECTED_CODES)
        self.assertLessEqual(len(value), MAX_CODE_LENGTH)

    def test_known_block_labels_are_the_complete_allowlist(self):
        self.assertEqual(host.REASONS, EXPECTED_REASONS)
        self.assertTrue(EXPECTED_REASONS)
        for reason in EXPECTED_REASONS:
            with self.subTest(reason=reason):
                code = host.failure_code(host.Block(reason))
                self.assertEqual(code, "BLOCK_REASON_" + reason)
                self.assert_bounded_code(code)

    def test_exact_blocks_are_never_formatted_on_known_or_unknown_paths(self):
        calls = {"repr": 0, "str": 0}

        def hostile_repr(_error):
            calls["repr"] += 1
            raise AssertionError("Block.__repr__ must not be called")

        def hostile_str(_error):
            calls["str"] += 1
            raise AssertionError("Block.__str__ must not be called")

        with patch.object(host.Block, "__repr__", hostile_repr), \
             patch.object(host.Block, "__str__", hostile_str):
            known = host.failure_code(host.Block("HOST"))
            unknown = host.failure_code(host.Block("PRIVATE_SECRET"))

        self.assertEqual(known, "BLOCK_REASON_HOST")
        self.assertEqual(unknown, UNKNOWN)
        self.assertEqual(calls, {"repr": 0, "str": 0})
        self.assert_bounded_code(known)
        self.assert_bounded_code(unknown)

    def test_unknown_and_near_miss_labels_collapse_to_unknown(self):
        labels = (
            "",
            "PRIVATE_SECRET",
            "host",
            " HOST",
            "HOST ",
            "HOST\n",
            "BLOCK_REASON_HOST",
            "HOST_EXTRA",
            "A" * 10000,
        )
        for index, label in enumerate(labels):
            with self.subTest(case=index):
                code = host.failure_code(host.Block(label))
                self.assertEqual(code, UNKNOWN)
                self.assert_bounded_code(code)

    def test_malformed_block_argument_counts_collapse_to_unknown(self):
        errors = (
            host.Block(),
            host.Block("HOST", "ENVIRONMENT_FILES"),
            host.Block("HOST", "private", "extra"),
        )
        for index, error in enumerate(errors):
            with self.subTest(case=index):
                code = host.failure_code(error)
                self.assertEqual(code, UNKNOWN)
                self.assert_bounded_code(code)

    def test_malformed_block_argument_types_collapse_to_unknown(self):
        arguments = (None, b"HOST", 1, True, ["HOST"], {"HOST": True}, ("HOST",))
        for index, argument in enumerate(arguments):
            with self.subTest(case=index):
                code = host.failure_code(host.Block(argument))
                self.assertEqual(code, UNKNOWN)
                self.assert_bounded_code(code)

    def test_block_subclasses_cannot_escape_allowlisted_labels(self):
        class DerivedBlock(host.Block):
            pass

        class DeeperBlock(DerivedBlock):
            pass

        for error_type in (DerivedBlock, DeeperBlock):
            for reason in ("HOST", "ENVIRONMENT_FILES", "PRIVATE_SECRET"):
                code = host.failure_code(error_type(reason))
                self.assertEqual(code, UNKNOWN)
                self.assert_bounded_code(code)

    def test_sibling_exception_types_cannot_escape_allowlisted_labels(self):
        for error_type in (ValueError, Exception, OSError):
            with self.subTest(error_type=error_type.__name__):
                code = host.failure_code(error_type("HOST"))
                self.assertEqual(code, UNKNOWN)
                self.assert_bounded_code(code)

    def test_hostile_exception_subclass_is_not_inspected_or_displayed(self):
        calls = {"args": 0, "repr": 0, "str": 0}

        class HostileValueError(ValueError):
            def __getattribute__(self, name):
                if name == "args":
                    calls["args"] += 1
                    raise AssertionError("exception args must not be read")
                return super().__getattribute__(name)

            def __repr__(self):
                calls["repr"] += 1
                raise AssertionError("repr must not be called")

            def __str__(self):
                calls["str"] += 1
                raise AssertionError("str must not be called")

        code = host.failure_code(HostileValueError("HOST"))
        self.assertEqual(code, UNKNOWN)
        self.assertEqual(calls, {"args": 0, "repr": 0, "str": 0})
        self.assert_bounded_code(code)

    def test_hostile_unrelated_object_is_not_inspected_or_displayed(self):
        calls = {"args": 0, "repr": 0, "str": 0}

        class HostileObject:
            def __getattribute__(self, name):
                if name == "args":
                    calls["args"] += 1
                    raise AssertionError("args must not be read")
                return object.__getattribute__(self, name)

            def __repr__(self):
                calls["repr"] += 1
                raise AssertionError("repr must not be called")

            def __str__(self):
                calls["str"] += 1
                raise AssertionError("str must not be called")

        code = host.failure_code(HostileObject())
        self.assertEqual(code, UNKNOWN)
        self.assertEqual(calls, {"args": 0, "repr": 0, "str": 0})
        self.assert_bounded_code(code)

    def test_hostile_block_subclass_is_not_inspected_or_displayed(self):
        calls = {"args": 0, "repr": 0, "str": 0}

        class HostileBlock(host.Block):
            def __getattribute__(self, name):
                if name == "args":
                    calls["args"] += 1
                    raise AssertionError("subclass args must not be read")
                return super().__getattribute__(name)

            def __repr__(self):
                calls["repr"] += 1
                raise AssertionError("repr must not be called")

            def __str__(self):
                calls["str"] += 1
                raise AssertionError("str must not be called")

        code = host.failure_code(HostileBlock("HOST"))
        self.assertEqual(code, UNKNOWN)
        self.assertEqual(calls, {"args": 0, "repr": 0, "str": 0})
        self.assert_bounded_code(code)

    def test_hostile_exact_block_argument_is_not_compared_or_displayed(self):
        calls = {"eq": 0, "hash": 0, "repr": 0, "str": 0}

        class HostileArgument:
            def __eq__(self, other):
                calls["eq"] += 1
                raise AssertionError("argument must not be compared")

            def __hash__(self):
                calls["hash"] += 1
                raise AssertionError("argument must not be hashed")

            def __repr__(self):
                calls["repr"] += 1
                raise AssertionError("repr must not be called")

            def __str__(self):
                calls["str"] += 1
                raise AssertionError("str must not be called")

        code = host.failure_code(host.Block(HostileArgument()))
        self.assertEqual(code, UNKNOWN)
        self.assertEqual(calls, {"eq": 0, "hash": 0, "repr": 0, "str": 0})
        self.assert_bounded_code(code)

    def test_hostile_str_subclass_cannot_bypass_exact_argument_type(self):
        calls = {"eq": 0, "hash": 0, "repr": 0, "str": 0}

        class HostileText(str):
            def __eq__(self, other):
                calls["eq"] += 1
                raise AssertionError("text subclass must not be compared")

            def __hash__(self):
                calls["hash"] += 1
                raise AssertionError("text subclass must not be hashed")

            def __repr__(self):
                calls["repr"] += 1
                raise AssertionError("repr must not be called")

            def __str__(self):
                calls["str"] += 1
                raise AssertionError("str must not be called")

        code = host.failure_code(host.Block(HostileText("HOST")))
        self.assertEqual(code, UNKNOWN)
        self.assertEqual(calls, {"eq": 0, "hash": 0, "repr": 0, "str": 0})
        self.assert_bounded_code(code)


if __name__ == "__main__":
    unittest.main()
