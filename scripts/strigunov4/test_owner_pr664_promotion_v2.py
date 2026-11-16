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
def runs(event="pull_request",gov="success"):
    return {"workflow_runs":[
       {"name":"PR Validation","event":event,"conclusion":"success","head_sha":SHA},
       {"name":"ASI trusted release governance","event":"pull_request",
         "conclusion":gov,"head_sha":SHA}]}

class PublisherNegativeTests(unittest.TestCase):
    def approval(self, pp, rr, runsdata):
        with patch.object(p,"gh",side_effect=[pp,rr,runsdata]):
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

if __name__=="__main__":unittest.main()
