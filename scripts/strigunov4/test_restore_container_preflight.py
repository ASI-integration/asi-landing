import tempfile
from pathlib import Path
import unittest
from unittest.mock import patch
import os

from restore_container_preflight import Block, DIGEST, EXTENSIONS, RUN, build_plan


class PreflightTests(unittest.TestCase):
    def manifest(self):
        return dict(run_id=RUN, cipher_sha256=DIGEST, runtime="podman",
            postgres_uid=999, postgres_gid=999, reviewed_memory_budget_mib=512,
            image="supabase/postgres@sha256:" + "a"*64,
            postgres_major=17, extensions=EXTENSIONS.copy(),
            binaries={n: "/reviewed/bin/"+n for n in ("initdb", "pg_ctl", "psql", "pg_restore")},
            database_services_disabled=True, blank_cluster_bootstrap_reviewed=True,
            bootstrap_reconciliation=dict(source_bootstrap_role="supabase_admin",source_bootstrap_oid=10,
                reviewed=True,create_role_replacement_count=1,
                original_globals_sha256="f708fb1cdccf47d0675e80b8b550edebb32b41ecad1a51337b4b8c5a9948b27c",
                execution_globals_sha256="d"*64,exact_diff_sha256="e"*64,
                all_other_statements_unchanged=True,oid10_assertion_replaces_create=True),
            vault_binary_root_key_behavior_reviewed=True, nonce="b"*32)

    def blocked(self, m, reason):
        with self.assertRaisesRegex(Block, reason):
            build_plan(m, "/nonexistent", "/nonexistent")

    def test_wrong_backup(self):
        m=self.manifest(); m["cipher_sha256"]="c"*64
        self.blocked(m, "WRONG_RUN")

    def test_unpinned_image(self):
        m=self.manifest(); m["image"]="supabase/postgres:latest"
        self.blocked(m, "PINNED_IMAGE")

    def test_root_postgres_rejected(self):
        m=self.manifest(); m["postgres_uid"]=0
        self.blocked(m, "NONROOT_POSTGRES")

    def test_root_group_rejected(self):
        m=self.manifest(); m["postgres_gid"]=0
        self.blocked(m, "NONROOT_POSTGRES")

    def test_guessed_memory_budget_rejected(self):
        m=self.manifest(); m["reviewed_memory_budget_mib"]=2048
        self.blocked(m, "MEMORY_BUDGET")

    def test_missing_hyphen_extension(self):
        m=self.manifest(); del m["extensions"]["uuid-ossp"]
        self.blocked(m, "EXACT_EXTENSION")

    def test_remote_target(self):
        m=self.manifest(); m["database_url"]="postgres://forbidden"
        self.blocked(m, "EXTERNAL_TARGET")

    def test_reused_container(self):
        m=self.manifest(); m["container"]="known-service"
        self.blocked(m, "EXTERNAL_TARGET")

    def test_guessed_binary(self):
        m=self.manifest(); del m["binaries"]["pg_ctl"]
        self.blocked(m, "BINARY_PATH_MISSING")

    def test_unreviewed_workers(self):
        m=self.manifest(); m["database_services_disabled"]=False
        self.blocked(m, "BACKGROUND_SERVICES")

    def test_public_parent(self):
        with tempfile.TemporaryDirectory() as d:
            parent=Path(d)/"strigunov4-restore-private"; parent.mkdir(mode=0o755)
            with self.assertRaisesRegex(Block,"OWNER_OR_MODE"):
                build_plan(self.manifest(),parent,"/nonexistent")

    def test_wrong_ciphertext(self):
        with tempfile.TemporaryDirectory() as d:
            parent=Path(d)/"strigunov4-restore-private"; parent.mkdir(mode=0o700)
            cipher=Path(d)/"cipher"; cipher.write_bytes(b"x"*339054)
            with self.assertRaisesRegex(Block,"HASH_MISMATCH"):
                build_plan(self.manifest(),parent,cipher)

    def test_wrong_parent_owner(self):
        with tempfile.TemporaryDirectory() as d:
            parent=Path(d)/"strigunov4-restore-private"; parent.mkdir(mode=0o700)
            with patch("os.getuid", return_value=os.getuid()+1):
                with self.assertRaisesRegex(Block,"OWNER_OR_MODE"):
                    build_plan(self.manifest(),parent,"/nonexistent")

    def test_missing_bootstrap_reconciliation(self):
        m=self.manifest(); del m["bootstrap_reconciliation"]
        self.blocked(m,"SOURCE_BOOTSTRAP")

    def test_unexpected_source_bootstrap(self):
        m=self.manifest(); m["bootstrap_reconciliation"]["source_bootstrap_role"]="unique_admin"
        self.blocked(m,"SOURCE_BOOTSTRAP")

    def test_multiple_globals_edits(self):
        m=self.manifest(); m["bootstrap_reconciliation"]["create_role_replacement_count"]=2
        self.blocked(m,"RECONCILIATION_REVIEW")


if __name__ == "__main__":
    unittest.main()
