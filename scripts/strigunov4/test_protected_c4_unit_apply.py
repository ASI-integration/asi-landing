"""Offline fail-closed checks: Beget G1 only; never makes SSH/network calls."""
import ast
import copy
import importlib.util
from pathlib import Path
import unittest
from unittest.mock import patch
SCRIPT=Path(__file__).with_name("protected_c4_unit_apply.py")
spec=importlib.util.spec_from_file_location("protected_c4_unit_apply", SCRIPT)
m=importlib.util.module_from_spec(spec)
spec.loader.exec_module(m)

GOOD={
 "status":"BEGET_G1_ISOLATED_PROCESS_OBSERVED","hostname":m.HOST,
 "pid":m.PID,"invocationId":m.INVOCATION,"unitHash":m.UNIT_SHA,
 "releaseSha":m.RELEASE,"noSendEffective":True,
 "health":200,"version":200,"reload":"no","nRestarts":0,
 "environmentMandatory":True,"loopbackOnly":True,"networkDeny":True,
 "kernelIngressAttached":True,"kernelEgressAttached":True,
 "bootDisabled":True,"actualEgressAttempted":False
}
CONTEXT={
 "GITHUB_REPOSITORY":"ASI-integration/asi-landing",
 "GITHUB_EVENT_NAME":"workflow_dispatch",
 "GITHUB_REF":"refs/heads/main","GITHUB_ACTOR_ID":"207600140",
 "GITHUB_TRIGGERING_ACTOR":"ASI-integration","GITHUB_RUN_ATTEMPT":"1",
 "GITHUB_WORKFLOW_REF":"ASI-integration/asi-landing/.github/workflows/strigunov4-c4-unit-apply.yml@refs/heads/main",
 "GITHUB_SHA":"a"*40,"GITHUB_WORKFLOW_SHA":"a"*40,
 "G1_PHYSICAL_TARGET":"beget-g1-readonly","BEGET_SSH_HOST":m.IP,
 "BEGET_SSH_PORT":"22","BEGET_SSH_USER":"root",
 "BEGET_SSH_PRIVATE_KEY":"-----BEGIN OPENSSH PRIVATE KEY-----\nSYNTHETIC\n-----END OPENSSH PRIVATE KEY-----\n"
}

class BegetProtectedWitnessTests(unittest.TestCase):
 def test_exact_beget_report(self):
  self.assertTrue(m.validate_report(GOOD))
 def test_each_identity_or_safety_drift_blocked(self):
  cases={
   "status":"PASS","hostname":"asi-pilot-lab-01","pid":250151,
   "invocationId":"foreign","unitHash":"0"*64,"releaseSha":"0"*40,
   "noSendEffective":False,"health":500,"version":500,"reload":"yes",
   "nRestarts":1,"environmentMandatory":False,"loopbackOnly":False,
   "networkDeny":False,"kernelIngressAttached":False,"kernelEgressAttached":False,
   "bootDisabled":False,"actualEgressAttempted":True}
  for name,value in cases.items():
   with self.subTest(name=name):
    report=copy.deepcopy(GOOD);report[name]=value
    with self.assertRaises(ValueError):m.validate_report(report)
 def test_missing_extra_and_wrong_type_rejected(self):
  for report in ({k:v for k,v in GOOD.items() if k!="kernelEgressAttached"},
                 dict(GOOD,secret="never"),dict(GOOD,pid=True),
                 dict(GOOD,noSendEffective=1)):
   with self.assertRaises(ValueError):m.validate_report(report)
 def test_exact_owner_target_and_checkout_binding(self):
  with patch.object(m.subprocess,"check_output",return_value="a"*40+"\n"):
   self.assertTrue(m.protected_context(CONTEXT).startswith("-----BEGIN"))
   for name in CONTEXT:
    value=CONTEXT[name]
    bad=dict(CONTEXT)
    bad[name]="0" if name!="BEGET_SSH_PRIVATE_KEY" else ""
    with self.subTest(name=name),self.assertRaises(ValueError):m.protected_context(bad)
    self.assertEqual(CONTEXT[name],value)
  with patch.object(m.subprocess,"check_output",return_value="b"*40+"\n"):
   with self.assertRaisesRegex(ValueError,"SOURCE_MISMATCH"):m.protected_context(CONTEXT)
 def test_read_only_fixed_remote_protocol(self):
  self.assertIn("bpftool",m.REMOTE)
  self.assertIn("cgroup_inet_egress",m.REMOTE)
  self.assertIn("127.0.0.1:3001",m.REMOTE)
  self.assertIn("MainPID",m.REMOTE)
  self.assertIn("actualEgressAttempted",m.REMOTE)
  self.assertIn("loopbackOnly",m.FIELDS)
  for forbidden in ("systemctl start","systemctl restart","requests.post","urllib.request.Request(method='POST'",
                    "git push","socket.connect(","os.environ[" ):
   self.assertNotIn(forbidden,m.REMOTE)
 def test_proxy_and_python_isolation_are_mandatory(self):
  self.assertIn("urllib.request.ProxyHandler({})",m.REMOTE)
  self.assertIn('run("ss","-Hltn")',m.REMOTE)
  source=Path(m.__file__).read_text()
  self.assertIn('"python3","-I","-B","-"',source)
 def test_listener_parser_adversarial(self):
  tree=ast.parse(m.REMOTE)
  func=next(n for n in tree.body if isinstance(n,ast.FunctionDef)
            and n.name=="loopback_listener_only")
  ns={}
  exec(compile(ast.Module(body=[func],type_ignores=[]),"<synthetic-listener-test>","exec"),ns)
  parse=ns["loopback_listener_only"]
  good="LISTEN 0 511 127.0.0.1:3001 0.0.0.0:*"
  ssh="LISTEN 0 4096 0.0.0.0:22 0.0.0.0:*"
  self.assertTrue(parse(good))
  self.assertTrue(parse(ssh+"\\n"+good))
  for case in ("",ssh, "LISTEN 0 511 *:3001 *:*",
               "LISTEN 0 511 [::]:3001 [::]:*",
               "LISTEN 0 511 31.129.96.181:3001 0.0.0.0:*",
               "LISTEN 0 511 127.0.0.1:30010 0.0.0.0:*",
               good+"\\n"+good,
               good+"\\n"+"LISTEN 0 511 *:3001 *:*",
               good+"\\n"+"LISTEN malformed"):
   with self.subTest(case=case):
    self.assertFalse(parse(case))
 def test_fixed_host_and_not_legacy_report(self):
  self.assertEqual(m.IP,"31.129.96.181")
  self.assertNotEqual(m.HOST,"asi-pilot-lab-01")
  self.assertEqual(len(m.UNIT_SHA),64)
  self.assertEqual(len(m.RELEASE),40)
  self.assertNotIn("65.21.249.108",m.REMOTE)

if __name__=="__main__":
 unittest.main()
