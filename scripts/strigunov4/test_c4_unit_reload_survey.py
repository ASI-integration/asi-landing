"""Read-only bounded manager survey tests, with all external I/O simulated."""
import tempfile
from pathlib import Path
from types import SimpleNamespace
from unittest.mock import MagicMock, patch
import unittest

import c4_unit_contract as c
import c4_unit_reload_survey as s

GOOD = ("asi-landing-staging.service loaded active running C4\n"
        "ssh.service loaded active running SSH daemon\n")
BAD = "asi-landing.service loaded active running Production\n" + GOOD


class ManagerSurveyTests(unittest.TestCase):
    def test_01_jobs_must_be_empty(self):
        self.assertTrue(s.jobs_quiet(""))
        self.assertTrue(s.jobs_quiet("  \n"))
        with self.assertRaises(c.Block):
            s.jobs_quiet("123 some.service start running\n")

    def test_02_staging_service_inventory(self):
        self.assertEqual(len(s.unit_inventory(GOOD)), 2)
        self.assertEqual(len(s.unit_inventory("● " + GOOD)), 2)

    def test_03_forbidden_or_missing_service_refused(self):
        for data in (BAD, "asi-sentinel.service loaded active running Sentinel\n" + GOOD,
                     "asi-landing-prod.service loaded active running Production\n" + GOOD,
                     "ssh.service loaded active running SSH daemon\n",
                     GOOD + GOOD, "not a service line\n"):
            with self.subTest(data=data[:20]), self.assertRaises(c.Block):
                s.unit_inventory(data)

    def test_04_source_owned_fixed_command_only(self):
        with self.assertRaises(c.Block):
            s.run_fixed(("systemctl", "daemon-reload"), s.time.monotonic() + 5)
        with self.assertRaises(c.Block):
            s.run_fixed(("sh", "-c", "echo bypass"), s.time.monotonic() + 5)

    def test_05_missing_generator_dirs_classified_not_approved(self):
        with tempfile.TemporaryDirectory() as td:
            self.assertEqual(s.generator_inventory((str(Path(td) / "missing"),)),
                             "NONE_OBSERVED")
        with self.assertRaises(c.Block):
            s.generator_inventory(())

    def test_05b_generator_file_is_unknown_not_safe(self):
        with tempfile.TemporaryDirectory() as td:
            path = Path(td) / "unexpected-file"
            path.write_text("not a directory")
            self.assertEqual(s.generator_inventory((str(path),)), "UNKNOWN")

    def test_06_survey_never_authorizes_reload(self):
        with patch.object(s.preflight, "host_identity"), \
             patch.object(s.preflight, "fixed_observation", return_value={"unitSha256": "a" * 64}), \
             patch.object(s, "run_fixed", side_effect=["", GOOD, GOOD, ""]) as fixed, \
             patch.object(s, "generator_inventory", return_value="PRESENT"):
            result = s.survey()
        self.assertEqual(fixed.call_count, 4)
        for call in (fixed.call_args_list[1], fixed.call_args_list[2]):
            self.assertIn("list-units", call.args[0])
            self.assertFalse(any(x.startswith("--type") for x in call.args[0]))
        self.assertFalse(result["daemonReloadAuthorized"])
        self.assertEqual(result["isolation"], "MANAGER_WIDE_NOT_PROVEN")
        self.assertEqual(result["generators"], "PRESENT")
        self.assertEqual(result["unitsSeen"], 2)
        self.assertEqual(result["jobs"], "NONE_OBSERVED")

    def test_07_even_empty_generators_do_not_authorize(self):
        with patch.object(s.preflight, "host_identity"), \
             patch.object(s.preflight, "fixed_observation", return_value={}), \
             patch.object(s, "run_fixed", side_effect=["", GOOD, GOOD, ""]), \
             patch.object(s, "generator_inventory", return_value="NONE_OBSERVED"):
            report = s.survey()
        self.assertFalse(report["daemonReloadAuthorized"])
        self.assertEqual(report["snapshot"], "NON_ATOMIC_CURRENT_ONLY")

    def test_08_unsafe_observation_is_preserved_as_a_risk(self):
        for jobs, services in (("PENDING", GOOD), ("", BAD)):
            with patch.object(s.preflight, "host_identity"), \
                 patch.object(s.preflight, "fixed_observation", return_value={}), \
                 patch.object(s, "run_fixed", side_effect=[jobs, services, services, jobs]), \
                 patch.object(s, "generator_inventory", return_value="NONE_OBSERVED"):
                receipt = s.survey()
            self.assertFalse(receipt["daemonReloadAuthorized"])
            self.assertEqual(receipt["jobs"], "PRESENT" if jobs else "NONE_OBSERVED")
            self.assertEqual(receipt["units"],
                             "NO_FORBIDDEN_UNIT_NAME_OBSERVED" if services == GOOD
                             else "CONFLICT_OR_UNKNOWN")


    def test_09_nonservice_units_and_forbidden_timer(self):
        data = GOOD + "apt-daily.timer loaded active waiting Timer\n"
        self.assertEqual(len(s.unit_inventory(data)), 3)
        for line in ("sentinel.timer loaded active waiting Timer\n",
                     "production.socket loaded active listening Socket\n",
                     "arbitrary.unknown loaded active running Unknown\n",
                     "x.timer invented active waiting Timer\n"):
            with self.subTest(line=line), self.assertRaises(c.Block):
                s.unit_inventory(GOOD + line)

    def test_10_environment_generator_metadata_is_covered(self):
        # Only an environment-generator directory exists. Omitting those
        # roots would incorrectly produce NONE_OBSERVED.
        envdir = "/etc/systemd/system-environment-generators"
        entry = MagicMock()
        entry.stat.return_value = SimpleNamespace(st_mode=0o100755, st_uid=0, st_nlink=1)
        scan = MagicMock()
        scan.__enter__.return_value = iter([entry])
        with patch.object(s.Path, "is_absolute", return_value=True), \
             patch.object(s.Path, "exists", autospec=True, side_effect=lambda p: p.as_posix() == envdir), \
             patch.object(s.Path, "is_symlink", return_value=False), \
             patch.object(s.Path, "resolve", autospec=True, side_effect=lambda p: p), \
             patch.object(s.Path, "lstat", return_value=SimpleNamespace(st_mode=0o40755, st_uid=0)), \
             patch.object(s.os, "scandir", return_value=scan):
            self.assertEqual(s.generator_inventory(), "PRESENT")

    def test_11_loaded_unit_drift_remains_unproven(self):
        changed = GOOD.replace("ssh.service loaded active running", "ssh.service loaded inactive dead")
        with patch.object(s.preflight, "host_identity"), \
             patch.object(s.preflight, "fixed_observation", return_value={}), \
             patch.object(s, "run_fixed", side_effect=["", GOOD, changed, ""]), \
             patch.object(s, "generator_inventory", return_value="NONE_OBSERVED"):
            report = s.survey()
        self.assertEqual(report["unitStability"], "DRIFT_OR_UNKNOWN")
        self.assertEqual(report["unitCoverage"], "LOADED_ALL_TYPES_ONLY")
        self.assertFalse(report["daemonReloadAuthorized"])

    def test_12_unit_process_drift_blocks_completed_survey(self):
        with patch.object(s.preflight, "host_identity"), \
             patch.object(s.preflight, "fixed_observation", side_effect=[{"processToken": "a"}, {"processToken": "b"}]), \
             patch.object(s, "run_fixed", side_effect=["", GOOD, GOOD, ""]), \
             patch.object(s, "generator_inventory", return_value="NONE_OBSERVED"), \
             self.assertRaises(c.Block):
            s.survey()


if __name__ == "__main__":
    unittest.main()
