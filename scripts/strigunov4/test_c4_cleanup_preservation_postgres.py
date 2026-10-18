"""Real PostgreSQL tests on a dedicated empty loopback test database only."""
import json
import os
from pathlib import Path
import shutil
import subprocess
import unittest

import c4_incident_exact_cleanup as c

TABLES=("booking_ops_records","booking_ops_events","booking_cleaning_tasks",
        "booking_linen_tasks","booking_supplies_tasks","booking_maintenance_tickets",
        "booking_physical_readiness","booking_physical_coordination_drafts",
        "c4_review_restrict","c4_review_setnull")
PHYSICAL=TABLES[2:8]

@unittest.skipUnless(os.environ.get("C4_ISOLATED_PG")=="1","isolated PG opt-in absent")
class PreservationPostgresTests(unittest.TestCase):
    @classmethod
    def setUpClass(cls):
        """Reject non-fixture settings and refuse to alter a nonempty public schema."""
        cls.psql=shutil.which("psql")
        if not cls.psql:
            candidate=Path(r"C:\Program Files\PostgreSQL\17\bin\psql.exe")
            cls.psql=str(candidate) if candidate.is_file() else None
        if not cls.psql:
            raise RuntimeError("test psql unavailable")
        cls.env={k:v for k,v in os.environ.items() if not k.startswith("PG")}
        cls.env.update(PGHOST="127.0.0.1",PGPORT="55479",PGUSER="c4_isolated",
                       PGDATABASE="c4_isolated",PGPASSWORD="c4_fixture_only",
                       PGSSLMODE="disable",PGCONNECT_TIMEOUT="5")
        version=cls.execute("SHOW server_version_num;").stdout.decode().strip()
        if not 170000<=int(version)<180000:
            raise RuntimeError("PostgreSQL17 required")
        count=cls.execute("SELECT count(*) FROM pg_class c JOIN pg_namespace n ON n.oid=c.relnamespace WHERE n.nspname='public';").stdout.strip()
        if count!=b"0":
            raise RuntimeError("refuse nonempty public schema")
        cls.execute("CREATE TABLE public.booking_ops_records(id text PRIMARY KEY, scope text);")
        cls.execute("CREATE TABLE public.booking_ops_events(id text PRIMARY KEY, booking_ops_record_id text REFERENCES public.booking_ops_records(id) ON DELETE CASCADE);")
        for t in PHYSICAL:
            cls.execute(f"CREATE TABLE public.{t}(id text PRIMARY KEY,booking_id text REFERENCES public.booking_ops_records(id) ON DELETE CASCADE);")
        cls.execute("CREATE TABLE public.c4_review_restrict(id text PRIMARY KEY,parent text REFERENCES public.booking_ops_events(id) ON DELETE RESTRICT);")
        cls.execute("CREATE TABLE public.c4_review_setnull(id text PRIMARY KEY,parent text REFERENCES public.booking_ops_events(id) ON DELETE SET NULL);")
        cls.execute("CREATE ROLE c4_read_denied NOLOGIN;")

    @classmethod
    def execute(cls,sql,ok=True):
        """Every call uses a new local connection; failing transactions roll back."""
        result=subprocess.run([cls.psql,"-X","-qAt","-v","ON_ERROR_STOP=1"],
                              input=sql.encode(),capture_output=True,env=cls.env,timeout=20)
        if ok and result.returncode:
            raise AssertionError(result.stderr.decode(errors="replace")[:500])
        return result

    def setUp(self):
        """Populate only test-owned rows, including unrelated tenant witnesses."""
        self.execute("TRUNCATE "+",".join("public."+t for t in TABLES)+";")
        b=c.audit.OWNED["booking"]
        self.execute(f"INSERT INTO public.booking_ops_records VALUES ('{b}','fixture'),('other','foreign');")
        self.execute(f"INSERT INTO public.booking_ops_events SELECT 'event'||i,'{b}' FROM generate_series(1,24) i; INSERT INTO public.booking_ops_events VALUES ('foreign-event','other');")
        for t in (PHYSICAL[0],PHYSICAL[1],PHYSICAL[2],PHYSICAL[4]):
            self.execute(f"INSERT INTO public.{t} VALUES ('owned','{b}'),('foreign','other');")
        self.execute("INSERT INTO public.c4_review_restrict VALUES ('r','event1'); INSERT INTO public.c4_review_setnull VALUES ('n','event1');")

    def snapshot(self):
        """Compare complete synthetic row values, not merely remaining counts."""
        return {t:self.execute(f"SELECT coalesce(jsonb_agg(to_jsonb(x) ORDER BY id),'[]'::jsonb) FROM public.{t} x;").stdout
                for t in TABLES}

    def assert_block_preserves(self,sql,code):
        before=self.snapshot()
        result=self.execute(sql,ok=False)
        self.assertNotEqual(result.returncode,0)
        self.assertIn(code.encode(),result.stderr)
        self.assertEqual(self.snapshot(),before)

    def test_audit_events_and_indirect_cascades_preserved_without_optional_tables(self):
        self.assert_block_preserves(c.cleanup_sql(),"C4_AUDIT_PRESERVATION_REQUIRED")

    def test_physical_rows_and_foreign_scope_preserved(self):
        self.execute("DELETE FROM public.c4_review_restrict; DELETE FROM public.c4_review_setnull; DELETE FROM public.booking_ops_events WHERE id<>'foreign-event';")
        self.assert_block_preserves(c.cleanup_sql(),"C4_PHYSICAL_PRESERVATION_REQUIRED")

    def test_zero_known_evidence_does_not_authorize_unknown_graph(self):
        self.execute("DELETE FROM public.c4_review_restrict; DELETE FROM public.c4_review_setnull; DELETE FROM public.booking_ops_events WHERE id<>'foreign-event';")
        for t in PHYSICAL:
            self.execute(f"DELETE FROM public.{t} WHERE booking_id<>'other';")
        self.assert_block_preserves(c.cleanup_sql(),"C4_DEPENDENCY_POLICY_REQUIRED")

    def test_prior_write_in_same_transaction_rolls_back_on_barrier(self):
        sql=c.cleanup_sql().replace("DO $c4preserve$",
            "UPDATE public.booking_ops_records SET scope='must-rollback' WHERE id='other';\nDO $c4preserve$",1)
        self.assert_block_preserves(sql,"C4_AUDIT_PRESERVATION_REQUIRED")

    def test_no_read_permission_never_deletes(self):
        self.assert_block_preserves("SET ROLE c4_read_denied;\n"+c.cleanup_sql(),"permission denied")

    def test_optional_schema_absence_remains_explicit_catalog_names(self):
        data=json.loads(self.execute(c.preservation_query()).stdout)
        self.assertEqual(data["auditEvents"],24)
        self.assertEqual(data["physicalRows"],4)
        self.assertEqual(len(data["missingOptionalRelations"]),10)
        self.assertEqual(data["missingOptionalRelations"],sorted(set(data["missingOptionalRelations"])))
        self.assertIn("public.guest_lifecycle_events",data["missingOptionalRelations"])

    @classmethod
    def tearDownClass(cls):
        """Remove only the tables and role created by this suite."""
        cls.execute("DROP TABLE "+",".join("public."+t for t in reversed(TABLES))+";")
        cls.execute("DROP ROLE c4_read_denied;")

if __name__=="__main__":
    unittest.main()
