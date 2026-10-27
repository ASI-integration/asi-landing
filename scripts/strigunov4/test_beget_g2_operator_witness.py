import copy
import json
import unittest
from unittest.mock import patch
import beget_g2_operator_witness as w

class WitnessTests(unittest.TestCase):
    def setUp(self):
        self.policy = dict(pid=46657, invocation="a"*32, crm="operator@example.invalid", ops="operator@example.invalid")
        self.identity = dict(host=w.HOST, unit=w.UNIT, release=w.RELEASE, unitHash=w.UNIT_HASH, pid=46657, invocation="a"*32)
        self.env = dict(w.FLAGS, CRM_OPERATOR_EMAILS=self.policy["crm"], OPS_ADMIN_EMAILS=self.policy["ops"])
    def result(self):
        return w.evaluate(self.identity, self.identity.copy(), self.env, self.policy)
    def test_positive_redacted(self):
        receipt = self.result()
        self.assertEqual(w.validate_receipt(receipt, self.policy), receipt)
        self.assertNotIn("@", json.dumps(receipt))
    def test_wrong_host_unit_release_hash_pid(self):
        for key in self.identity:
            with self.subTest(key=key):
                altered = self.identity | {key: "WRONG"}
                with self.assertRaises(w.Block):
                    w.evaluate(altered, altered, self.env, self.policy)
    def test_pid_race(self):
        with self.assertRaises(w.Block):
            w.evaluate(self.identity, self.identity | {"pid":46658}, self.env, self.policy)
    def test_every_flag_off(self):
        for key in w.FLAGS:
            with self.subTest(key=key), self.assertRaises(w.Block):
                w.evaluate(self.identity,self.identity,self.env | {key:"wrong"},self.policy)
    def test_missing_extra_keys(self):
        for env in [self.env | {"UNKNOWN":"secret"}, {k:v for k,v in self.env.items() if k!="OPS_ADMIN_EMAILS"}]:
            with self.assertRaises(w.Block):
                w.evaluate(self.identity,self.identity,env,self.policy)
    def test_unauthorized_members(self):
        for key in (*w.LISTS,"OPERATOR_EMAIL"):
            with self.subTest(key=key), self.assertRaises(w.Block):
                w.evaluate(self.identity,self.identity,self.env | {key:"stranger@example.invalid"},self.policy)
    def test_effective_crm_alias(self):
        env=self.env | {"CRM_OPERATOR_EMAILS":"", "OPERATOR_EMAIL":self.policy["crm"]}
        self.assertEqual(w.evaluate(self.identity,self.identity,env,self.policy)["effectiveLists"],2)
    def test_empty_and_wildcard(self):
        for raw in ("","*@example.invalid"):
            with self.subTest(raw=raw), self.assertRaises(w.Block):
                w.evaluate(self.identity,self.identity,self.env | {"OPS_ADMIN_EMAILS":raw},self.policy)
    def test_duplicate_env(self):
        raw=b"OPS_ADMIN_EMAILS=a@b\0OPS_ADMIN_EMAILS=c@d\0"
        with self.assertRaises(w.Block):
            w.selected_env(raw)
    def test_duplicate_policy(self):
        with self.assertRaises(w.Block):
            json.loads('{"pid":1,"pid":2}',object_pairs_hook=w.unique)
    def test_malformed_receipts(self):
        for change in ({"effectiveFlags":True},{"extra":"secret"},{"humanLogin":"PASS"},{"pid":True}):
            with self.subTest(change=change), self.assertRaises(w.Block):
                w.validate_receipt(self.result() | change,self.policy)
    def test_symlink_open_failure_preserved(self):
        with patch.object(w.os,"open",side_effect=OSError("symlink denied")):
            with self.assertRaises(OSError):
                w.trusted_file("/etc/asi-g2-witness-policy.json")
    def test_no_privilege_no_secret_read(self):
        with patch.object(w.os,"geteuid",return_value=993), patch.object(w.os,"uname") as uname, patch.object(w,"trusted_file") as read, patch.object(w.sys,"argv",["witness"]):
            uname.return_value.nodename=w.HOST
            with self.assertRaisesRegex(w.Block,"AUTHORIZED_WITNESS_NOT_INSTALLED"):
                w.observe()
            read.assert_not_called()
    def test_arguments_rejected(self):
        with patch.object(w.sys,"argv",["witness","anything"]), self.assertRaisesRegex(w.Block,"ARGS"):
            w.observe()

if __name__=="__main__":
    unittest.main()
