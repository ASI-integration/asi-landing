import copy
import json
import unittest
import stat
from types import SimpleNamespace
from unittest.mock import patch
import beget_g2_operator_witness as w

class WitnessTests(unittest.TestCase):
    def setUp(self):
        self.policy = dict(release="b"*40, unitHash="c"*64, pid=46657, invocation="a"*32, crm="operator@example.invalid", ops="operator@example.invalid")
        self.identity = dict(host=w.HOST, unit=w.UNIT, release=self.policy["release"], unitHash=self.policy["unitHash"], pid=46657, invocation="a"*32)
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
    def test_old_policy_cannot_supply_default_release(self):
        for key in ("release", "unitHash"):
            old = {k:v for k,v in self.policy.items() if k != key}
            with self.assertRaises(w.Block):
                w.evaluate(self.identity, self.identity, self.env, old)
    def test_new_release_requires_new_exact_policy_and_receipt(self):
        old_receipt = self.result()
        new = self.identity | {"release":"d"*40,"pid":47777,"invocation":"e"*32}
        with self.assertRaises(w.Block):
            w.evaluate(new,new,self.env,self.policy)
        policy = self.policy | {k:new[k] for k in ("release","pid","invocation")}
        receipt = w.evaluate(new,new,self.env,policy)
        self.assertEqual(w.validate_receipt(receipt,policy),receipt)
        with self.assertRaises(w.Block):
            w.validate_receipt(old_receipt,policy)
    def test_private_file_modes_and_identity(self):
        def info(mode=0o600, uid=0, ino=10):
            return SimpleNamespace(st_mode=stat.S_IFREG | mode, st_uid=uid, st_gid=0,
                st_nlink=1, st_size=2, st_dev=1, st_ino=ino, st_mtime_ns=1, st_ctime_ns=1)
        for mode, private, accepted in [(0o600, True, True), (0o400, True, True),
                                       (0o644, True, False), (0o640, True, False),
                                       (0o604, True, False), (0o644, False, True)]:
            meta = info(mode)
            with self.subTest(mode=mode, private=private), patch.object(w.os, "open", return_value=9), \
                 patch.object(w.os, "close"), patch.object(w.os, "fstat", return_value=meta), \
                 patch.object(w.os, "stat", return_value=meta), patch.object(w.os, "read", return_value=b"{}") as read:
                if accepted:
                    self.assertEqual(w.trusted_file("/policy", private=private), b"{}")
                else:
                    with self.assertRaisesRegex(w.Block, "POLICY_MODE"):
                        w.trusted_file("/policy", private=private)
                    read.assert_not_called()
        with patch.object(w.os, "open", return_value=9), patch.object(w.os, "close"), \
             patch.object(w.os, "fstat", return_value=info(uid=65534)), patch.object(w.os, "read") as read:
            with self.assertRaisesRegex(w.Block, "FILE"):
                w.trusted_file("/policy", private=True)
            read.assert_not_called()
        with patch.object(w.os, "open", return_value=9), patch.object(w.os, "close"), \
             patch.object(w.os, "fstat", return_value=info()), patch.object(w.os, "read", return_value=b"{}"), \
             patch.object(w.os, "stat", return_value=info(ino=11)):
            with self.assertRaisesRegex(w.Block, "FILE_RACE"):
                w.trusted_file("/policy", private=True)

    def test_snapshot_rejects_loaded_dropin_or_wrong_fragment(self):
        props = dict(MainPID=str(self.policy["pid"]), InvocationID=self.policy["invocation"],
            ActiveState="active", User="asi-staging", Group="asi-staging",
            WorkingDirectory="/var/www/asi-staging/current", NeedDaemonReload="no",
            EnvironmentFiles="/var/www/asi-staging/shared/.env.staging.local (ignore_errors=no)",
            FragmentPath="/etc/systemd/system/" + w.UNIT, DropInPaths="")
        with patch.object(w.subprocess, "check_output") as show, patch.object(w.Path, "resolve") as resolve, \
             patch.object(w, "trusted_file", return_value=b"unit") as read, patch.object(w.os, "uname") as uname:
            resolve.return_value = w.Path("/var/www/asi-staging/releases/" + self.policy["release"])
            uname.return_value.nodename = w.HOST
            show.return_value = "\n".join(k + "=" + v for k,v in props.items())
            self.assertEqual(w.snapshot(self.policy)["pid"], self.policy["pid"])
            self.assertIn("-pDropInPaths", show.call_args.args[0])
            self.assertIn("-pFragmentPath", show.call_args.args[0])
            for change in ({"DropInPaths":"/etc/systemd/system/"+w.UNIT+".d/override.conf"},
                           {"FragmentPath":"/run/systemd/system/"+w.UNIT}, {"DropInPaths":None}):
                altered = props | change
                show.return_value = "\n".join(k + "=" + v for k,v in altered.items() if v is not None)
                read.reset_mock()
                with self.assertRaisesRegex(w.Block, "UNIT_OVERRIDE"):
                    w.snapshot(self.policy)
                read.assert_not_called()

    def test_observe_private_policy_reread_and_race(self):
        raw = b"".join((k+"="+v).encode()+b"\0" for k,v in self.env.items())
        with patch.object(w.sys, "argv", ["witness"]), patch.dict(w.os.environ, {}, clear=True), \
             patch.object(w.os, "geteuid", return_value=0), patch.object(w.os, "uname") as uname, \
             patch.object(w, "snapshot", return_value=self.identity), patch.object(w.os, "open", return_value=9), \
             patch.object(w.os, "read", return_value=raw), patch.object(w.os, "pread", return_value=raw), \
             patch.object(w.os, "close"), patch.object(w, "trusted_file", return_value=json.dumps(self.policy)) as read:
            uname.return_value.nodename = w.HOST
            self.assertEqual(w.observe(), self.result())
            self.assertEqual(read.call_count, 2)
            for call in read.call_args_list:
                self.assertEqual(call.args, (w.POLICY,))
                self.assertEqual(call.kwargs, {"private":True})
            read.side_effect = [json.dumps(self.policy), json.dumps(self.policy | {"pid":47777})]
            with self.assertRaisesRegex(w.Block, "POLICY_RACE"):
                w.observe()

    def test_arguments_rejected(self):
        with patch.object(w.sys,"argv",["witness","anything"]), self.assertRaisesRegex(w.Block,"ARGS"):
            w.observe()

if __name__=="__main__":
    unittest.main()
