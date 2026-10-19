"""Read-only bounded manager survey tests, with all external I/O simulated."""
import tempfile
from pathlib import Path
from unittest.mock import patch
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
        self.assertEqual(s.service_inventory(GOOD), 2)
        self.assertEqual(s.service_inventory("● " + GOOD), 2)

    def test_03_forbidden_or_missing_service_refused(self):
        for data in (BAD, "asi-sentinel.service loaded active running Sentinel\n" + GOOD,
                     "asi-landing-prod.service loaded active running Production\n" + GOOD,
                     "ssh.service loaded active running SSH daemon\n",
                     GOOD + GOOD, "not a service line\n"):
            with self.subTest(data=data[:20]), self.assertRaises(c.Block):
                s.service_inventory(data)

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
             patch.object(s, "run_fixed", side_effect=["", GOOD]) as fixed, \
             patch.object(s, "generator_inventory", return_value="PRESENT"):
            result = s.survey()
        self.assertEqual(fixed.call_count, 2)
        self.assertFalse(result["daemonReloadAuthorized"])
        self.assertEqual(result["isolation"], "MANAGER_WIDE_NOT_PROVEN")
        self.assertEqual(result["generators"], "PRESENT")
        self.assertEqual(result["servicesSeen"], 2)
        self.assertEqual(result["jobs"], "NONE_OBSERVED")

    def test_07_even_empty_generators_do_not_authorize(self):
        with patch.object(s.preflight, "host_identity"), \
             patch.object(s.preflight, "fixed_observation", return_value={}), \
             patch.object(s, "run_fixed", side_effect=["", GOOD]), \
             patch.object(s, "generator_inventory", return_value="NONE_OBSERVED"):
            report = s.survey()
        self.assertFalse(report["daemonReloadAuthorized"])
        self.assertEqual(report["snapshot"], "NON_ATOMIC_CURRENT_ONLY")

    def test_08_any_unsafe_observation_blocks_survey(self):
        for jobs, services in ((None, GOOD), ("", BAD)):
            with patch.object(s.preflight, "host_identity"), \
                 patch.object(s.preflight, "fixed_observation", return_value={}), \
                 patch.object(s, "run_fixed", side_effect=[jobs or "PENDING" if jobs is None else jobs, services]), \
                 patch.object(s, "generator_inventory", return_value="NONE_OBSERVED"), \
                 self.assertRaises(c.Block):
                s.survey()


if __name__ == "__main__":
    unittest.main()
