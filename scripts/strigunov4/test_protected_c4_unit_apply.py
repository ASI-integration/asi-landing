"""Offline negative tests for run-bound protected G1 witness; no network/actions."""
import copy
import importlib.util
import pathlib
import unittest

SCRIPT = pathlib.Path(__file__).with_name("protected_c4_unit_apply.py")
spec = importlib.util.spec_from_file_location("protected_c4_unit_apply",SCRIPT)
m=importlib.util.module_from_spec(spec)
spec.loader.exec_module(m)

LAB = {
 "hostname":"asi-pilot-lab-01","pid":250151,
 "invocationId":"f9713b4e2fcd46d2967b8cdf7c9678db",
 "unitHash":m.UNIT_SHA,"witnessHash":m.WITNESS_SHA,"releaseSha":m.EXPECTED_RELEASE,
 "noSendEffective":True,"egressBlocked":True,"health":200,"version":200,"reload":"no","enabledAtBoot":False
}
OLD = {
 "hostname":"asi-agent-runner","pid":m.OLD_PID,"unitHash":m.OLD_UNIT_SHA,
 "health":200,"reload":"no","environmentOptional":True
}

class PhysicalG1ProofTests(unittest.TestCase):
 def test_valid_lab_and_unchanged_old(self):
  self.assertTrue(m.validate_lab_report(LAB))
  self.assertTrue(m.validate_old_report(OLD))
 def test_lab_fail_closed(self):
  cases=[
    ("hostname","asi-pilot-lab-02"),("pid",250152),
    ("invocationId","deadbeef"),("unitHash","0"*64),("witnessHash","0"*64),
    ("releaseSha","0"*40),("noSendEffective",False),("egressBlocked",False),
    ("health",503),("version",503),("reload","yes"),("enabledAtBoot",True)
  ]
  for key,value in cases:
   with self.subTest(key=key):
    data=copy.deepcopy(LAB);data[key]=value
    with self.assertRaises(ValueError):m.validate_lab_report(data)
 def test_reject_missing_or_extra_report_fields(self):
  for data in ({k:v for k,v in LAB.items() if k!="witnessHash"},{**LAB,"approvalClaim":True}):
   with self.assertRaises(ValueError):m.validate_lab_report(data)
 def test_old_staging_must_remain_unchanged(self):
  cases=[("hostname","other"),("pid",12),("unitHash","f"*64),
         ("health",500),("reload","yes"),("environmentOptional",False)]
  for key,value in cases:
   with self.subTest(key=key):
    data=dict(OLD);data[key]=value
    with self.assertRaises(ValueError):m.validate_old_report(data)
 def test_no_write_or_send_paths_in_reviewed_scripts(self):
  for code in (m.REMOTE_LAB,m.REMOTE_OLD):
   self.assertNotIn("systemctl start",code)
   self.assertNotIn("systemctl restart",code)
   self.assertNotIn("iptables -I",code)
   self.assertNotIn("requests.post",code)
 def test_pins(self):
  self.assertEqual(len(m.UNIT_SHA),64)
  self.assertEqual(len(m.WITNESS_SHA),64)
  self.assertEqual(len(m.EXPECTED_RELEASE),40)
  self.assertTrue(m.REMOTE_LAB.strip().startswith("import "))

if __name__=="__main__":
 unittest.main()
