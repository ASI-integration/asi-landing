"""Credential-free parser and protected transport regression tests."""
import json
from pathlib import Path
import unittest
from unittest.mock import patch

import c4_operator_patch as p
import c4_operator_host as host
import protected_c4_operator_repair as gate


def env_bytes(extra=b""):
    return b"".join((k + "=" + v + "\n").encode() for k, v in p.SAFETY.items()) + extra


class PatchTests(unittest.TestCase):
    def test_append_only_fixed_members(self):
        result = p.plan(env_bytes(b'SECRET=retained-value\nCRM_OPERATOR_EMAILS="A@example.org,b@example.org"\n'))
        self.assertIn(b"SECRET=retained-value\n", result["output"])
        self.assertEqual(result["after"]["CRM_OPERATOR_EMAILS"],
                         {"a@example.org", "b@example.org", p.OPERATOR})
        self.assertEqual(result["changedLists"], 2)

    def test_idempotent_plan(self):
        raw = p.plan(env_bytes())["output"]
        self.assertEqual(p.plan(raw)["output"], raw)
        self.assertFalse(p.plan(raw)["changed"])

    def test_duplicate_members_deduplicated(self):
        result = p.plan(env_bytes(b"CRM_OPERATOR_EMAILS=A@example.org,a@example.org\n"))
        self.assertEqual(result["output"].count(b"A@example.org"), 1)
        self.assertNotIn(b"a@example.org", result["output"])

    def test_duplicate_assignments_rejected(self):
        for key in (*p.KEYS, *p.SAFETY):
            raw = env_bytes()
            if key in p.KEYS:
                raw += (key + "=a@b.test\n").encode()
            raw += (key + "=a@b.test\n").encode()
            with self.subTest(key=key), self.assertRaises(p.Block):
                p.plan(raw)

    def test_malformed_or_multiline_rejected(self):
        cases = [b"\0", b"\r\n", b"KEY=a\vCRM_OPERATOR_EMAILS=b@c.test\n",
                 "KEY=a\u2028CRM_OPERATOR_EMAILS=b@c.test\n".encode(), b"KEY=x\\\n", b'KEY="unfinished\n',
                 b"export CRM_OPERATOR_EMAILS=a@b.test\n",
                 b'KEY="multiline\nCRM_OPERATOR_EMAILS=x@y.test\n"\n']
        cases.extend(prefix + b" note " + bytes([92, 10]) + b"CRM_OPERATOR_EMAILS=\n"
                     for prefix in (b"#", b";"))
        for extra in cases:
            with self.subTest(extra=extra), self.assertRaises(p.Block):
                p.plan(env_bytes(extra))
        for raw in [b"", env_bytes()[:-1], b"x" * 131073, env_bytes(b"KEY=\xff\n")]:
            with self.assertRaises(p.Block):
                p.plan(raw)

    def test_safety_flags_required_and_unchanged(self):
        for key, value in p.SAFETY.items():
            raw = env_bytes().replace((key + "=" + value).encode(), (key + "=unsafe").encode())
            with self.subTest(key=key), self.assertRaises(p.Block):
                p.plan(raw)
        out = p.plan(env_bytes())["output"]
        self.assertTrue(out.startswith(env_bytes()))

    def test_formats_and_empty_allowlist(self):
        for value in ["", " ", "'A@b.test; B@c.test'", '"A@b.test B@c.test"']:
            raw = env_bytes(("CRM_OPERATOR_EMAILS=" + value + "\n").encode())
            self.assertIn(p.OPERATOR, p.plan(raw)["after"]["CRM_OPERATOR_EMAILS"])

    def test_injection_wildcard_invalid_email(self):
        for value in ["*", "a", "a@b.test $OTHER", "a@b.test\\", "a@b.test\x00"]:
            with self.subTest(value=value), self.assertRaises(p.Block):
                p.plan(env_bytes(("CRM_OPERATOR_EMAILS=" + value + "\n").encode()))

    def test_unrelated_bytes_preserved(self):
        raw = env_bytes(b'# comment\n; comment\nSECRET="a b = # not printed"\n\n')
        raw += b"# path " + bytes([92]) + b" retained\n; normal comment\n"
        self.assertTrue(p.plan(raw)["output"].startswith(raw))


class GateTests(unittest.TestCase):
    def context(self):
        sha = "a" * 40
        return dict(GITHUB_ACTIONS="true", GITHUB_REPOSITORY=gate.REPO,
                    GITHUB_REF="refs/heads/main", GITHUB_EVENT_NAME="workflow_dispatch",
                    GITHUB_WORKFLOW_REF=gate.WORKFLOW, GITHUB_ACTOR=gate.OWNER,
                    GITHUB_TRIGGERING_ACTOR=gate.OWNER, GITHUB_ACTOR_ID=gate.OWNER_ID,
                    GITHUB_RUN_ATTEMPT="1", STAGING_SSH_USER="project_ayfaar",
                    GITHUB_SHA=sha, GITHUB_WORKFLOW_SHA=sha, STAGING_REVIEWED_MAIN_SHA=sha,
                    C4_OPERATOR_CONFIRM="CONFIGURE_C4_OPERATOR_" + sha,
                    C4_OPERATOR_INCIDENT="39140030546", GITHUB_RUN_ID="123",
                    STAGING_SSH_HOST="isolated.invalid", STAGING_SSH_PORT="22",
                    STAGING_SSH_PRIVATE_KEY="synthetic-only" * 20)

    def test_exact_context(self):
        self.assertEqual(gate.validate(self.context())[:2], ("a" * 40, "123"))

    def test_context_drift_blocks_before_transport(self):
        for key in self.context():
            env = self.context()
            if key in ("STAGING_SSH_PRIVATE_KEY", "STAGING_SSH_HOST", "STAGING_SSH_PORT"):
                env[key] = ""
            else:
                env[key] = "wrong"
            # Empty port intentionally means 22; all other guards fail closed.
            if key == "STAGING_SSH_PORT":
                env[key] = "0"
            with self.subTest(key=key), self.assertRaises(gate.Block):
                gate.validate(env)

    def test_remote_exact_success_only(self):
        self.assertEqual(gate.decode_remote_result(json.dumps(host.SUCCESS).encode(), 0),
                         host.SUCCESS)
        for raw, code in [(b"{}", 0), (b"secret-sensitive-error", 2),
                          (json.dumps(host.SUCCESS).encode(), 2),
                          (json.dumps(dict(host.SUCCESS, extra="secret")).encode(), 0)]:
            with self.assertRaises(gate.RemoteOutcome) as result:
                gate.decode_remote_result(raw, code)
            self.assertEqual(str(result.exception), "BLOCK_MANUAL_RECOVERY_REQUIRED")

    def test_known_failure_closed(self):
        for status in host.BLOCKS:
            with self.assertRaises(gate.RemoteOutcome) as result:
                gate.decode_remote_result(json.dumps({"status": status}).encode(), 2)
            self.assertEqual(result.exception.status, status)

    def test_embedded_payload_compiles_without_execution(self):
        payload = gate.payload()
        compile(payload, "protected-operator-payload", "exec")
        self.assertIn(b"c4_operator_patch", payload)
        self.assertNotIn(b"STAGING_DATABASE_URL", payload)

    def test_checkout_mismatch_never_ssh(self):
        with patch.object(gate, "checked", return_value=b"b" * 40), \
                patch.object(gate, "payload") as payload:
            with self.assertRaises(gate.Block):
                gate.execute(self.context())
            payload.assert_not_called()


if __name__ == "__main__":
    unittest.main()
