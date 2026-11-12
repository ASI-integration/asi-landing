"""Raw-byte duplicate regressions against the real G2 parsers."""
import unittest

import c4_operator_observer as observer
import c4_operator_patch as operator
from test_asi_v9_g2_json_boundary import marker_bytes, safe_env


class JsonDuplicateKeyTests(unittest.TestCase):
    def test_duplicate_status_in_either_order_fails_closed(self):
        for raw in (
            b'{"status":"ROLLBACK_PASS","status":"BLOCK_BEFORE_APPLY"}',
            b'{"status":"BLOCK_BEFORE_APPLY","status":"ROLLBACK_PASS"}',
            b'{"status":"ROLLBACK_PASS","status":"ROLLBACK_PASS"}',
            b'{"status":"ROLLBACK_PASS","sta\\u0074us":"ROLLBACK_PASS"}',
        ):
            with self.subTest(raw=raw):
                with self.assertRaisesRegex(ValueError, "DUPLICATE_JSON_KEY"):
                    observer.strict_json(raw)
                self.assertEqual(marker_bytes(raw), "INVALID")

    def test_nested_duplicate_keys_fail_closed(self):
        for raw in (
            b'{"outer":{"id":1,"id":2}}',
            b'{"outer":[{"id":1,"id":1}]}',
            b'{"outer":[{"inner":{"id":1,"\\u0069d":2}}]}',
            b'{"outer":{"same":{},"same":[]}}',
        ):
            with self.subTest(raw=raw):
                with self.assertRaisesRegex(ValueError, "DUPLICATE_JSON_KEY"):
                    observer.strict_json(raw)
                self.assertEqual(marker_bytes(raw), "INVALID")

    def test_duplicate_prepared_identifiers_fail_closed(self):
        # Valid synthetic binding: ambiguity must not be labeled OTHER_BINDING.
        base = (b'{"runId":"123","sourceSha":"' + b'a' * 40
                + b'","status":"PREPARED","changedLists":2')
        self.assertEqual(marker_bytes(base + b'}', "prepared"), "OTHER_BINDING")
        for extra in (b',"runId":"123"', b',"runId":"456"',
                      b',"run\\u0049d":"123"',
                      b',"sourceSha":"' + b'a' * 40 + b'"',
                      b',"sourceSha":"' + b'b' * 40 + b'"'):
            raw = base + extra + b'}'
            with self.subTest(extra=extra):
                with self.assertRaisesRegex(ValueError, "DUPLICATE_JSON_KEY"):
                    observer.strict_json(raw)
                self.assertEqual(marker_bytes(raw, "prepared"), "INVALID")

    def test_same_identifier_key_in_separate_objects_is_valid(self):
        raw = b'{"left":{"id":"same"},"right":{"id":"same"}}'
        self.assertEqual(observer.strict_json(raw),
                         {"left": {"id": "same"}, "right": {"id": "same"}})

    def test_duplicate_environment_identifiers_fail_closed(self):
        for key in (*operator.KEYS, *operator.SAFETY):
            first = (key + "=a@example.test\n").encode()
            raw = safe_env(first if key in operator.KEYS else b'')
            for second in (first, (key + "=b@example.test\n").encode()):
                with self.subTest(key=key, second=second):
                    with self.assertRaisesRegex(operator.Block,
                                                "DUPLICATE_TARGET_OR_SAFETY"):
                        operator.plan(raw + second)

    def test_duplicate_email_members_have_exact_union(self):
        result = operator.plan(safe_env(
            b'CRM_OPERATOR_EMAILS=A@example.test,a@example.test;B@example.test\n'))
        self.assertEqual(result["before"][operator.KEYS[0]],
                         {"a@example.test", "b@example.test"})
        self.assertEqual(result["after"][operator.KEYS[0]],
                         {"a@example.test", "b@example.test", operator.OPERATOR})
        self.assertEqual(result["output"].count(b'A@example.test'), 1)
        self.assertNotIn(b'a@example.test', result["output"])


if __name__ == "__main__":
    unittest.main()
