"""Independent SQL fixtures on a disposable, empty loopback PostgreSQL17 database."""
import json
import os
from pathlib import Path
import shutil
import subprocess
import unittest
import c4_dependency_readonly as c

PHYSICAL = ("booking_cleaning_tasks", "booking_linen_tasks",
            "booking_supplies_tasks", "booking_physical_readiness")
EXTRA = ("booking_ops_events", "booking_ops_domain_events", "booking_ops_worker_tasks",
         "booking_ops_secure_task_links", "booking_ops_worker_link_audit")
ACTIVE = set(c.ROOTS) | set(PHYSICAL) | set(EXTRA)
B, A, P, U, I = (c.prior.OWNED[k] for k in ("booking", "account", "property", "user", "intake"))
FOREIGN = "aaaaaaaa-aaaa-4aaa-aaaa-aaaaaaaaaaaa"
EVENT = "bbbbbbbb-bbbb-4bbb-bbbb-bbbbbbbbbbbb"
TASK = "cccccccc-cccc-4ccc-cccc-cccccccccccc"
LINK = "dddddddd-dddd-4ddd-dddd-dddddddddddd"
AUDIT = "eeeeeeee-eeee-4eee-eeee-eeeeeeeeeeee"


@unittest.skipUnless(os.environ.get("C4_DEPENDENCY_ISOLATED_PG") == "1", "isolated opt-in absent")
class DependencyPostgresTests(unittest.TestCase):
    @classmethod
    def setUpClass(cls):
        """Refuse a nonempty schema or a server other than PostgreSQL17."""
        cls.psql = shutil.which("psql") or str(Path(r"C:\Program Files\PostgreSQL\17\bin\psql.exe"))
        cls.env = {k:v for k,v in os.environ.items() if not k.startswith("PG")}
        cls.env.update(PGHOST="127.0.0.1", PGPORT="55481", PGUSER="c4_dependency",
                       PGDATABASE="c4_dependency", PGPASSWORD="isolated_fixture_only",
                       PGSSLMODE="disable", PGCONNECT_TIMEOUT="5")
        version = int(cls.sql("SHOW server_version_num;").stdout.strip())
        if not 170000 <= version < 180000:
            raise RuntimeError("PostgreSQL17 required")
        if cls.sql("SELECT count(*) FROM pg_class c JOIN pg_namespace n ON n.oid=c.relnamespace WHERE n.nspname='public';").stdout.strip() != b"0":
            raise RuntimeError("refuse nonempty public schema")
        cls.sql("""
CREATE TABLE users(id uuid PRIMARY KEY,email text);
CREATE TABLE accounts(id uuid PRIMARY KEY,name text);
CREATE TABLE properties(id uuid PRIMARY KEY,account_id uuid REFERENCES accounts(id) ON DELETE CASCADE,name text);
CREATE TABLE booking_ops_records(id uuid PRIMARY KEY,account_id text,property_id text,booking_id text,guest_name text,availability_hold_id uuid);
CREATE FUNCTION booking_ops_record_insert_scope_guard_v1() RETURNS trigger LANGUAGE plpgsql AS $$ BEGIN RETURN NEW; END $$;
CREATE TRIGGER booking_ops_record_insert_scope_guard_v1 BEFORE INSERT ON booking_ops_records FOR EACH ROW EXECUTE FUNCTION booking_ops_record_insert_scope_guard_v1();
CREATE TABLE booking_inbound_intake_events(id uuid PRIMARY KEY,account_id uuid REFERENCES accounts(id) ON DELETE CASCADE,property_id text,booking_id uuid);
CREATE TABLE booking_ops_events(id uuid PRIMARY KEY,booking_ops_record_id uuid REFERENCES booking_ops_records(id) ON DELETE CASCADE,payload text);
CREATE TABLE booking_ops_domain_events(id uuid PRIMARY KEY,booking_id uuid REFERENCES booking_ops_records(id) ON DELETE CASCADE,causation_id uuid REFERENCES booking_ops_domain_events(id));
CREATE TABLE booking_ops_worker_tasks(id uuid PRIMARY KEY,booking_id uuid REFERENCES booking_ops_records(id) ON DELETE CASCADE,completion_event_id uuid REFERENCES booking_ops_domain_events(id));
CREATE TABLE booking_ops_secure_task_links(id uuid PRIMARY KEY,task_id uuid REFERENCES booking_ops_worker_tasks(id) ON DELETE CASCADE);
CREATE TABLE booking_ops_worker_link_audit(id uuid PRIMARY KEY,booking_id uuid REFERENCES booking_ops_records(id) ON DELETE CASCADE,task_id uuid REFERENCES booking_ops_worker_tasks(id) ON DELETE CASCADE,link_id uuid REFERENCES booking_ops_secure_task_links(id) ON DELETE SET NULL);
CREATE ROLE c4_dependency_denied NOLOGIN;
""")
        for t in PHYSICAL:
            cls.sql(f"CREATE TABLE {t}(id uuid PRIMARY KEY,booking_id uuid REFERENCES booking_ops_records(id) ON DELETE CASCADE,property_id text);")

    @classmethod
    def sql(cls, query, ok=True):
        """Use no inherited PG credentials and suppress error contents in failures."""
        result = subprocess.run([cls.psql, "-X", "-qAt", "-v", "ON_ERROR_STOP=1"],
                                input=query.encode(), capture_output=True, env=cls.env, timeout=60)
        if ok and result.returncode:
            raise AssertionError("isolated query failed: " + result.stderr.decode(errors="replace")[:700])
        return result

    def setUp(self):
        """Only synthetic data; distinct unrelated rows witness accidental changes."""
        self.sql("TRUNCATE "+",".join(sorted(ACTIVE))+";")
        self.sql(f"""
INSERT INTO users VALUES ('{U}','staging-acceptance@asi.local'),('{FOREIGN}','secret-foreign@example.invalid');
INSERT INTO accounts VALUES ('{A}','C4 staging isolated account 39047710115'),('{FOREIGN}','private foreign account');
INSERT INTO properties VALUES ('{P}','{A}','C4 isolated property 39047710115'),('{FOREIGN}','{FOREIGN}','foreign property');
INSERT INTO booking_ops_records VALUES ('{B}','{A}','{P}','C4-external','C4 synthetic guest 39047710115',NULL),('{FOREIGN}','{FOREIGN}','{FOREIGN}','foreign-external','sensitive guest',NULL);
INSERT INTO booking_inbound_intake_events VALUES ('{I}','{A}','{P}','{B}');
INSERT INTO booking_ops_events SELECT md5(i::text)::uuid,'{B}','PRIVATE MESSAGE CONTENT' FROM generate_series(1,24) i;
INSERT INTO booking_ops_events VALUES ('{FOREIGN}','{FOREIGN}','foreign secret');
INSERT INTO booking_ops_domain_events VALUES ('{EVENT}','{B}',NULL);
INSERT INTO booking_ops_worker_tasks VALUES ('{TASK}','{B}','{EVENT}');
INSERT INTO booking_ops_secure_task_links VALUES ('{LINK}','{TASK}');
INSERT INTO booking_ops_worker_link_audit VALUES ('{AUDIT}','{B}','{TASK}','{LINK}');
""")
        for t in PHYSICAL:
            self.sql(f"INSERT INTO {t} VALUES ('{TASK}','{B}','{P}'),('{FOREIGN}','{FOREIGN}','{FOREIGN}');")

    def catalog(self):
        """Obtain genuine PostgreSQL metadata; never mock catalog SQL behavior."""
        return json.loads(self.sql(c.catalog_sql()).stdout)

    def witness(self):
        """Run the exact production schema checker and guarded read-only SQL."""
        catalog = self.catalog()
        missing = c.schema_check(catalog)
        return c.receipt(json.loads(self.sql(c.guarded_sql(catalog, missing)).stdout), missing)

    def snapshot(self):
        """Full synthetic rows prove reads did not detach or mutate evidence."""
        return {t:self.sql(f"SELECT coalesce(jsonb_agg(to_jsonb(r) ORDER BY to_jsonb(r)::text),'[]') FROM {t} r;").stdout
                for t in ACTIVE}

    def test_counts_indirect_cascade_setnull_absence_privacy_and_no_mutation(self):
        """Traverse all actions and expose only validated aggregate evidence."""
        before = self.snapshot()
        result = self.witness()
        self.assertEqual(result["status"], "C4_DEPENDENCY_READONLY_SCOPED_PASS")
        self.assertEqual(result["tables"]["booking_ops_events"]["incidentLinked"], 24)
        self.assertEqual(result["tables"]["booking_ops_secure_task_links"]["incidentLinked"], 1)
        self.assertEqual(result["tables"]["booking_ops_worker_link_audit"]["incidentLinked"], 1)
        self.assertIsNone(result["tables"]["partner_communication_sessions"])
        for secret in ("PRIVATE MESSAGE", "sensitive guest", "example.invalid", B, U):
            self.assertNotIn(secret, json.dumps(result))
        self.assertEqual(before, self.snapshot())
        self.assertFalse(result["cleanupAuthorized"])

    def test_recursive_cycle_deduplicates(self):
        """A self-reference terminates without depth-based omission."""
        self.sql(f"UPDATE booking_ops_domain_events SET causation_id='{EVENT}';")
        result = self.witness()
        self.assertEqual(result["tables"]["booking_ops_domain_events"]["incidentLinked"], 1)

    def test_cross_tenant_fk_and_external_key_collision_block(self):
        """An incident event referenced by another booking must not become owned."""
        self.sql(f"INSERT INTO booking_ops_worker_tasks VALUES ('{FOREIGN}','{FOREIGN}','{EVENT}');")
        result = self.witness()
        self.assertEqual(result["status"], "BLOCK")
        self.assertEqual(result["tables"]["booking_ops_worker_tasks"]["scopeConflicts"], 1)
        self.sql("UPDATE booking_ops_records SET booking_id='C4-external';")
        result = self.witness()
        self.assertEqual(result["status"], "BLOCK")
        self.assertEqual(result["tables"]["booking_ops_records"]["scopeConflicts"], 1)

    def test_missing_relation_and_column_fail_closed(self):
        """A renamed required relation/column is not an empty result."""
        self.sql("ALTER TABLE booking_ops_events RENAME TO hidden_events;")
        try:
            with self.assertRaises(c.Block):
                c.schema_check(self.catalog())
        finally:
            self.sql("ALTER TABLE hidden_events RENAME TO booking_ops_events;")
        self.sql("ALTER TABLE booking_ops_events RENAME COLUMN booking_ops_record_id TO hidden_parent;")
        try:
            with self.assertRaises(c.Block):
                c.schema_check(self.catalog())
        finally:
            self.sql("ALTER TABLE booking_ops_events RENAME COLUMN hidden_parent TO booking_ops_record_id;")

    def test_unknown_cross_schema_fk_and_trigger_block(self):
        """Unknown dependency metadata never selects additional row tables."""
        self.sql("CREATE SCHEMA c4_extra; CREATE TABLE c4_extra.foreign_child(id uuid REFERENCES public.booking_ops_records(id));")
        try:
            with self.assertRaises(c.Block):
                c.schema_check(self.catalog())
        finally:
            self.sql("DROP TABLE c4_extra.foreign_child; DROP SCHEMA c4_extra;")
        self.sql("CREATE TRIGGER unexpected BEFORE INSERT ON booking_ops_records FOR EACH ROW EXECUTE FUNCTION booking_ops_record_insert_scope_guard_v1();")
        try:
            with self.assertRaises(c.Block):
                c.schema_check(self.catalog())
        finally:
            self.sql("DROP TRIGGER unexpected ON booking_ops_records;")

    def test_schema_race_and_access_denial_preserve_rows(self):
        """Second-snapshot catalog check and read permission errors stop the census."""
        before = self.snapshot()
        catalog = self.catalog()
        missing = c.schema_check(catalog)
        self.sql("ALTER TABLE booking_ops_events ADD COLUMN drift text;")
        try:
            result = self.sql(c.guarded_sql(catalog, missing), ok=False)
            self.assertNotEqual(result.returncode, 0)
            self.assertIn(b"C4_SCHEMA_RACE", result.stderr)
        finally:
            self.sql("ALTER TABLE booking_ops_events DROP COLUMN drift;")
        result = self.sql("SET ROLE c4_dependency_denied;"+c.guarded_sql(catalog, missing), ok=False)
        self.assertNotEqual(result.returncode, 0)
        self.assertEqual(before, self.snapshot())

    def test_read_only_denies_write_and_rollback_restores_connection(self):
        """A deliberately injected write fails; a later connection sees the old rows."""
        before = self.snapshot()
        catalog = self.catalog()
        query = c.guarded_sql(catalog, c.schema_check(catalog))
        query = query.replace("DO $guard$", "UPDATE public.users SET email='must-not-persist'; DO $guard$", 1)
        self.assertNotEqual(self.sql(query, ok=False).returncode, 0)
        self.assertEqual(before, self.snapshot())
        self.assertEqual(self.witness()["status"], "C4_DEPENDENCY_READONLY_SCOPED_PASS")

    def test_composite_keys_and_foreign_module_rows(self):
        """Composite identities preserve distinct modules without including other tenants."""
        self.sql("CREATE TABLE ops_v17_onboardings(id uuid PRIMARY KEY,account_id text); CREATE TABLE ops_v17_module_state(onboarding_id uuid REFERENCES ops_v17_onboardings(id) ON DELETE CASCADE,module_key text,PRIMARY KEY(onboarding_id,module_key));")
        try:
            self.sql(f"INSERT INTO ops_v17_onboardings VALUES ('{TASK}','{A}'),('{FOREIGN}','{FOREIGN}'); INSERT INTO ops_v17_module_state VALUES ('{TASK}','one'),('{TASK}','two'),('{FOREIGN}','one');")
            result = self.witness()
            self.assertEqual(result["tables"]["ops_v17_module_state"]["incidentLinked"],2)
            self.assertEqual(result["tables"]["ops_v17_module_state"]["scopeConflicts"],0)
        finally:
            self.sql("DROP TABLE ops_v17_module_state,ops_v17_onboardings;")

    def test_rls_cannot_fabricate_zero(self):
        """A SELECT-only role with hidden rows must fail, never return empty evidence."""
        names = ",".join(sorted(ACTIVE))
        self.sql(f"GRANT USAGE ON SCHEMA public TO c4_dependency_denied; GRANT SELECT ON {names} TO c4_dependency_denied; ALTER TABLE booking_ops_events ENABLE ROW LEVEL SECURITY;")
        try:
            cat = self.catalog()
            result = self.sql("SET ROLE c4_dependency_denied;"+c.guarded_sql(cat,c.schema_check(cat)),ok=False)
            self.assertNotEqual(result.returncode,0)
            self.assertIn(b"row-level security",result.stderr)
        finally:
            self.sql(f"ALTER TABLE booking_ops_events DISABLE ROW LEVEL SECURITY; REVOKE SELECT ON {names} FROM c4_dependency_denied; REVOKE USAGE ON SCHEMA public FROM c4_dependency_denied;")

    @classmethod
    def tearDownClass(cls):
        """Remove only synthetic objects created by this suite."""
        cls.sql("DROP TABLE "+",".join(sorted(ACTIVE))+";")
        cls.sql("DROP FUNCTION booking_ops_record_insert_scope_guard_v1(); DROP ROLE c4_dependency_denied;")


if __name__ == "__main__":
    unittest.main()
