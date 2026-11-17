"""Non-privileged offline regression; never touches the live stage."""
import io, json, os, pathlib, subprocess, sys, tarfile, tempfile, unittest
from unittest.mock import patch
import owner_pr664_promotion_v2 as p

SHA=p.SHA
def pr(draft=False, review="APPROVED"):
    return {"state":"OPEN","isDraft":draft,"reviewDecision":review,
       "headRefOid":SHA,"baseRefName":"asi/acceptance-fixture-provision-20261116",
       "author":{"login":"author"}}
def review(commit=SHA,who="independent"):
    return [{"state":"APPROVED","commit_id":commit,"user":{"login":who}}]
def compare(status="ahead"):
    return {"status": status}

def runs(event="pull_request",gov="success"):
    return {"workflow_runs":[
       {"name":"PR Validation","event":event,"conclusion":"success","head_sha":SHA},
       {"name":"ASI trusted release governance","event":"pull_request",
         "conclusion":gov,"head_sha":SHA}]}

class PublisherNegativeTests(unittest.TestCase):
    def approval(self, pp, rr, runsdata, comparedata=None):
        with patch.object(p,"gh",side_effect=[pp,rr,runsdata,comparedata or compare()]):
            return p.verify_github()
    def test_exact_approved_native_checks_pass(self):
        self.assertEqual(self.approval(pr(),review(),runs()),[])
    def test_draft_never_approved(self):
        self.assertIn("PR664_STILL_DRAFT",self.approval(pr(draft=True),review(),runs()))
    def test_dispatch_only_ci_not_trusted(self):
        self.assertIn("NATIVE_PR_CI_NOT_PASSED",
            self.approval(pr(),review(),runs(event="workflow_dispatch")))
    def test_failing_governance_not_trusted(self):
        self.assertIn("TRUSTED_RELEASE_NOT_APPROVED",
            self.approval(pr(),review(),runs(gov="startup_failure")))
    def test_stale_review_rejected(self):
        self.assertIn("INDEPENDENT_SHA_REVIEW_MISSING",
            self.approval(pr(),review(commit="0"*40),runs()))
    def test_self_review_rejected(self):
        self.assertIn("INDEPENDENT_SHA_REVIEW_MISSING",
            self.approval(pr(),review(who="author"),runs()))
    def test_not_up_to_date_with_main_blocks_release(self):
        self.assertIn("PR664_NOT_UP_TO_DATE_WITH_MAIN",
            self.approval(pr(),review(),runs(),compare("diverged")))

    def test_no_tty_cannot_promote(self):
        with patch.object(p.os,"geteuid",return_value=0),patch.object(p.sys.stdin,"isatty",return_value=False):
            with self.assertRaisesRegex(p.Blocked,"DIRECT_OWNER_INTERACTIVE_ROOT_TTY_REQUIRED"):
                p.promote()
    def test_missing_review_keeps_preflight_blocked(self):
        with patch.object(p,"verify_artifact"),patch.object(p,"verify_archive_members",return_value=100),patch.object(p,"verify_stage",return_value="test"),patch.object(p,"verify_github",return_value=["PR664_STILL_DRAFT"]),patch.object(p,"verify_publisher_review",return_value=[]):
            report=p.preflight()
            self.assertEqual(report["status"],"BLOCKED")
            self.assertEqual(report["stage_mutations"],0)
    def test_bad_archive_hash_refused(self):
        with tempfile.TemporaryDirectory() as t:
            archive=pathlib.Path(t)/"not-sealed.tar.zst"
            manifest=pathlib.Path(t)/"manifest.json"
            archive.write_bytes(b"bad");manifest.write_text("{}")
            with patch.object(p,"ARCHIVE",archive),patch.object(p,"MANIFEST",manifest):
                with self.assertRaisesRegex(p.Blocked,"SEALED_HASH_DRIFT"):
                    p.verify_artifact()
    def test_archive_symlink_escape_rejected(self):
        with tempfile.TemporaryDirectory() as t:
            tar=pathlib.Path(t)/"unsafe.tar"
            archive=pathlib.Path(t)/"unsafe.tar.zst"
            with tarfile.open(tar,"w") as f:
                item=tarfile.TarInfo("./node_modules/escape")
                item.type=tarfile.SYMTYPE
                item.linkname="../../../../etc"
                f.addfile(item)
            subprocess.run(["zstd","-q","-o",str(archive),str(tar)],check=True)
            with patch.object(p,"ARCHIVE",archive):
                with self.assertRaisesRegex(p.Blocked,"LINK_ESCAPE"):
                    p.verify_archive_members()

    def test_privileged_publisher_requires_own_independent_review(self):
        import base64
        source="approved source code\n"
        pp={"state":"OPEN","isDraft":True,"reviewDecision":"",
            "headRefOid":"a"*40,"author":{"login":"author"}}
        entry={"content":base64.b64encode(source.encode()).decode()}
        with patch.object(p,"gh",side_effect=[pp,[],entry,{"workflow_runs":[]}]), \
             patch.object(p.pathlib.Path,"read_text",return_value=source):
            blockers=p.verify_publisher_review()
        self.assertIn("PR665_PUBLISHER_STILL_DRAFT",blockers)
        self.assertIn("PR665_INDEPENDENT_REVIEW_MISSING",blockers)
        self.assertIn("PR665_NATIVE_CI_NOT_PASSED",blockers)

    def test_privileged_publisher_source_drift_blocked(self):
        import base64
        pp={"state":"OPEN","isDraft":False,"reviewDecision":"APPROVED",
            "headRefOid":"a"*40,"author":{"login":"author"}}
        reviews=[{"state":"APPROVED","commit_id":"a"*40,
                  "user":{"login":"reviewer"}}]
        entry={"content":base64.b64encode(b"wrong-reviewed-source\n").decode()}
        ci={"workflow_runs":[{"name":"PR Validation","head_sha":"a"*40,
                              "event":"pull_request","conclusion":"success"}]}
        with patch.object(p,"gh",side_effect=[pp,reviews,entry,ci]), \
             patch.object(p.pathlib.Path,"read_text",return_value="live-source"):
            blockers=p.verify_publisher_review()
        self.assertIn("PUBLISHER_SOURCE_NOT_APPROVED",blockers)

    def test_fresh_authority_revocation_is_fail_closed(self):
        with patch.object(p,"verify_github",return_value=["PR664_REVIEW_NOT_APPROVED"]), \\
             patch.object(p,"verify_publisher_review",return_value=[]):
            with self.assertRaisesRegex(p.Blocked,"RELEASE_AUTHORITY_REVOKED_OR_STALE"):
                p.assert_fresh_release_authority()

    def test_revocation_after_owner_input_keeps_stage_untouched(self):
        with tempfile.TemporaryDirectory() as t:
            stage=pathlib.Path(t)/"stage"
            old=stage/"releases"/"old"
            target=stage/"releases"/"new"
            old.mkdir(parents=True)
            current=stage/"current";current.symlink_to(old)
            lock=pathlib.Path(t)/"owner.lock"
            phrase="PROMOTE-PR664-"+p.SHA[:12]+"-"+p.ARTSHA[:12]
            with patch.object(p,"STAGE",stage),patch.object(p,"CURRENT",current), \\
                 patch.object(p,"OLD",old),patch.object(p,"TARGET",target), \\
                 patch.object(p,"LOCK",lock),patch.object(p,"preflight",return_value={"status":"READY_FOR_OWNER_CONFIRMATION"}), \\
                 patch.object(p,"verify_stage",return_value=str(old)),patch.object(p,"verify_artifact"), \\
                 patch.object(p,"verify_archive_members"), \\
                 patch.object(p,"assert_fresh_release_authority",side_effect=p.Blocked("REVOKED")), \\
                 patch.object(p.os,"geteuid",return_value=0),patch.object(p.sys.stdin,"isatty",return_value=True), \\
                 patch("builtins.input",return_value=phrase):
                with self.assertRaisesRegex(p.Blocked,"REVOKED"):
                    p.promote()
            self.assertEqual(current.resolve(),old)
            self.assertFalse(target.exists())

    def test_revocation_after_extraction_blocks_switch(self):
        with tempfile.TemporaryDirectory() as t:
            stage=pathlib.Path(t)/"stage"
            old=stage/"releases"/"old"
            target=stage/"releases"/"new"
            old.mkdir(parents=True)
            current=stage/"current";current.symlink_to(old)
            lock=pathlib.Path(t)/"owner.lock"
            phrase="PROMOTE-PR664-"+p.SHA[:12]+"-"+p.ARTSHA[:12]
            switched=[];restarts=[]
            def fake_cmd(*args,**kwargs):
                if args[0]=="tar":(target/"release-meta.json").write_text(json.dumps({"gitSha":p.SHA}))
                if args[:2]==("systemctl","restart"):restarts.append(True)
                return ""
            def forbidden_switch(*args):switched.append(True)
            with patch.object(p,"STAGE",stage),patch.object(p,"CURRENT",current), \\
                 patch.object(p,"OLD",old),patch.object(p,"TARGET",target), \\
                 patch.object(p,"LOCK",lock),patch.object(p,"preflight",return_value={"status":"READY_FOR_OWNER_CONFIRMATION"}), \\
                 patch.object(p,"verify_stage",return_value=str(old)),patch.object(p,"verify_artifact"), \\
                 patch.object(p,"verify_archive_members"), \\
                 patch.object(p,"cmd",side_effect=fake_cmd),patch.object(p,"switch",side_effect=forbidden_switch), \\
                 patch.object(p,"assert_fresh_release_authority",side_effect=[None,p.Blocked("REVOKED")]), \\
                 patch.object(p.os,"geteuid",return_value=0),patch.object(p.sys.stdin,"isatty",return_value=True), \\
                 patch("builtins.input",return_value=phrase):
                with self.assertRaisesRegex(p.Blocked,"PROMOTION_FAILED_BEFORE_SWITCH"):
                    p.promote()
            self.assertEqual(current.resolve(),old)
            self.assertEqual(switched,[])
            self.assertEqual(restarts,[])

    def test_restart_failure_restores_old_symlink(self):
        with tempfile.TemporaryDirectory() as t:
            stage=pathlib.Path(t)/"stage"
            old=stage/"releases"/"old"
            target=stage/"releases"/"new"
            old.mkdir(parents=True)
            current=stage/"current"
            current.symlink_to(old)
            lock=pathlib.Path(t)/"owner.lock"
            calls=[]
            def fake_cmd(*args,**kwargs):
                if args[0]=="tar":
                    (target/"release-meta.json").write_text(
                        json.dumps({"gitSha":p.SHA}))
                if args[:2]==("systemctl","restart"):
                    calls.append("restart")
                    if len(calls)==1:raise p.Blocked("SIMULATED_RESTART_FAILURE")
                return ""
            with patch.object(p,"STAGE",stage),patch.object(p,"CURRENT",current), \
                 patch.object(p,"OLD",old),patch.object(p,"TARGET",target), \
                 patch.object(p,"LOCK",lock),patch.object(p,"preflight",
                    return_value={"status":"READY_FOR_OWNER_CONFIRMATION"}), \
                 patch.object(p,"verify_stage",return_value=str(old)), \
                 patch.object(p,"verify_artifact"),patch.object(p,"verify_archive_members"), \
                 patch.object(p,"cmd",side_effect=fake_cmd), \
                 patch.object(p,"get",return_value=(200,b"")), \
                 patch.object(p,"assert_fresh_release_authority"), \
                 patch.object(p.os,"geteuid",return_value=0), \
                 patch.object(p.sys.stdin,"isatty",return_value=True), \
                 patch("builtins.input",return_value=
                    "PROMOTE-PR664-"+p.SHA[:12]+"-"+p.ARTSHA[:12]):
                with patch("builtins.print"):
                    with self.assertRaisesRegex(p.Blocked,"PROMOTION_FAILED_ROLLED_BACK"):
                        p.promote()
            self.assertEqual(current.resolve(),old)
            self.assertEqual(len(calls),2)

if __name__=="__main__":unittest.main()
