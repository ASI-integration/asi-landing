"""Fixture-only regression: no reinitialization of a staged Engine's durable state."""
import ast
import importlib.util
import json
from pathlib import Path
import tempfile
import unittest
from unittest.mock import patch

ROOT = Path(__file__).parent
SPEC = importlib.util.spec_from_file_location("beget_installer", ROOT / "beget-install.py")
INSTALLER = importlib.util.module_from_spec(SPEC)
SPEC.loader.exec_module(INSTALLER)


class StagedStatePreservation(unittest.TestCase):
    def check_case(self, repaired: bool, existing: bool):
        with tempfile.TemporaryDirectory(prefix="asi-stage-pristine-") as t:
            root = Path(t)
            authority = root / "auth"
            authority.mkdir()
            state = root / "state"
            state.mkdir()
            raw = b'{"fixture":"pristine"}'
            if repaired:
                (authority / ("repaired-stage-" + INSTALLER.digest(raw) + ".json")).write_text("{}")
            if existing:
                (state / "state").mkdir()
                locked = state / "state" / "autopilot-ledger.json"
                locked.write_text(json.dumps({
                    "schemaVersion": "asi.execution-adapters.v1",
                    "mode": "FAILED_LOCKED",
                    "jobs": {"old": {"mode": "FAILED_LOCKED"}}
                }))
                before = locked.read_bytes()
            with patch.object(INSTALLER, "AUTH", authority),                  patch.object(INSTALLER, "STATE", state),                  patch.object(INSTALLER, "staged_state", return_value="fixture-service-identity"),                  patch.object(INSTALLER, "repaired_staged_state", return_value="fixture-service-identity"),                  patch.object(INSTALLER, "stage_scope"),                  patch.object(INSTALLER, "signed", return_value={}):
                if existing:
                    with self.assertRaisesRegex(INSTALLER.Block, "STAGED_STATE_NOT_PRISTINE"):
                        INSTALLER.verify_staged_generation(raw, {}, {}, b"public", 100)
                    self.assertEqual(locked.read_bytes(), before)
                else:
                    result = INSTALLER.verify_staged_generation(raw, {}, {}, b"public", 100)
                    self.assertEqual(result, "fixture-service-identity")

    def test_first_stage_empty_original_allowed(self):
        self.check_case(False, False)

    def test_first_stage_empty_repair_allowed(self):
        self.check_case(True, False)

    def test_failed_locked_original_preserved(self):
        self.check_case(False, True)

    def test_failed_locked_repair_preserved(self):
        self.check_case(True, True)

    def test_initializer_checks_nonempty_root_before_writing(self):
        tree = ast.parse((ROOT / "beget-install.py").read_text())
        assign = next(n for n in ast.walk(tree) if isinstance(n, ast.Assign)
                      and any(isinstance(x, ast.Name) and x.id == "code" for x in n.targets)
                      and isinstance(n.value, ast.Constant) and isinstance(n.value.value, str)
                      and "initializeState(BEGET.root" in n.value.value)
        code = assign.value.value
        self.assertLess(code.index("await fs.readdir(BEGET.root)"),
                        code.index("await initializeState(BEGET.root"))


if __name__ == "__main__":
    unittest.main()
