"""Actual isolated PG17 reconciliation of empty, partial and conflicting fixtures."""
import json
import os
import unittest

import c4_retained_readonly as c
import test_c4_dependency_postgres as fixtures

U, A, P = (c.ROOTS[k] for k in ("users","accounts","properties"))
B = "12121212-1212-4212-8212-121212121212"
I = "13131313-1313-4313-8313-131313131313"
EXTRA = "14141414-1414-4414-8414-141414141414"


@unittest.skipUnless(os.environ.get("C4_DEPENDENCY_ISOLATED_PG") == "1", "isolated opt-in absent")
class RetainedReadonlyPostgresTests(unittest.TestCase):
    setUpClass = classmethod(fixtures.DependencyPostgresTests.setUpClass.__func__)
    tearDownClass = classmethod(fixtures.DependencyPostgresTests.tearDownClass.__func__)
    sql = classmethod(fixtures.DependencyPostgresTests.sql.__func__)
    def setUp(self):
        """Reset independent fixtures before adding typed state columns for this probe."""
        for name in c.STATES: self.sql(f"ALTER TABLE {name} DROP COLUMN IF EXISTS status;")
        self.sql("ALTER TABLE booking_physical_readiness DROP COLUMN IF EXISTS final_ready;")
        fixtures.DependencyPostgresTests.setUp(self)
        for name, states in c.STATES.items():
            self.sql(f"ALTER TABLE {name} ADD COLUMN status text DEFAULT '{states[0]}';")
        self.sql("ALTER TABLE booking_physical_readiness ADD COLUMN final_ready boolean DEFAULT false;")

    catalog = fixtures.DependencyPostgresTests.catalog
    snapshot = fixtures.DependencyPostgresTests.snapshot

    def seed(self, booking=False, intake=False):
        """Create only disposable local test rows, never invoke application handlers."""
        self.sql(f"""
INSERT INTO users VALUES ('{U}','{c.EMAIL}');
INSERT INTO accounts VALUES ('{A}','C4 staging isolated account {c.RUN}');
INSERT INTO properties VALUES ('{P}','{A}','C4 isolated property {c.RUN}');
""")
        if booking:
            self.sql(f"INSERT INTO booking_ops_records VALUES ('{B}','{A}','{P}','retained-external','C4 synthetic guest {c.RUN}',NULL);")
        if intake:
            link = f"'{B}'" if booking else "NULL"
            self.sql(f"INSERT INTO booking_inbound_intake_events(id,account_id,property_id,booking_id) VALUES ('{I}','{A}','{P}',{link});")

    def witness(self):
        """Execute the exact guarded SQL and public receipt validator."""
        catalog = self.catalog()
        missing = c.schema_check(catalog)
        data = json.loads(self.sql(c.guarded_sql(catalog,missing)).stdout)
        return c.receipt(data,missing)

    def observe_unchanged(self):
        """Compare every field of every synthetic row before and after reading."""
        before = self.snapshot()
        result = self.witness()
        self.assertEqual(before,self.snapshot())
        self.assertFalse(result["stagingWrites"])
        self.assertFalse(result["physicalReplayAuthorized"])
        return result

    def test_empty_root_and_partial_lifecycle_observations_preserve_every_row(self):
        """Absent, roots-only, booking-only and complete identities are distinct."""
        self.assertEqual(self.observe_unchanged()["observation"],"NO_ROWS_OBSERVED")
        self.seed()
        self.assertEqual(self.observe_unchanged()["observation"],"ROOTS_ONLY_OBSERVED")
        self.setUp();self.seed(booking=True)
        self.assertEqual(self.observe_unchanged()["bookingIds"],[B])
        self.setUp();self.seed(booking=True,intake=True)
        result = self.observe_unchanged()
        self.assertEqual(result["observation"],"BOOKING_AND_INTAKE_OBSERVED")
        self.assertEqual(result["intakeIds"],[I])
        self.assertEqual(result["fullPhysicalE2E"],"NOT_YET_PROVEN")
        for secret in ("sensitive guest","PRIVATE MESSAGE","foreign-external",c.EMAIL):
            self.assertNotIn(secret,json.dumps(result))

    def test_intake_before_booking_and_missing_root_remain_partial(self):
        """Partially committed creation is evidence, never a retry instruction."""
        self.seed(intake=True)
        result = self.observe_unchanged()
        self.assertEqual(result["observation"],"PARTIAL_FLOW_OBSERVED")
        self.assertEqual(result["intakeIds"],[I])
        self.sql(f"DELETE FROM users WHERE id='{U}';")
        result = self.observe_unchanged()
        self.assertIn("PARTIAL_ROOTS",result["blockCodes"])
        self.assertEqual(result["intakeIds"],[])

    def test_duplicate_bookings_and_wrong_synthetic_marker_block_without_ids(self):
        """A root match is insufficient when candidates are ambiguous or foreign."""
        self.seed(booking=True,intake=True)
        self.sql(f"INSERT INTO booking_ops_records VALUES ('{EXTRA}','{A}','{P}','other','C4 synthetic guest {c.RUN}',NULL);")
        result = self.observe_unchanged()
        self.assertIn("MULTIPLE_CANDIDATES",result["blockCodes"])
        self.assertEqual(result["bookingIds"],[])
        self.sql(f"DELETE FROM booking_ops_records WHERE id='{EXTRA}'; UPDATE booking_ops_records SET guest_name='private unrelated person' WHERE id='{B}';")
        result = self.observe_unchanged()
        self.assertIn("CROSS_SCOPE_ROWS",result["blockCodes"])
        self.assertNotIn("private unrelated person",json.dumps(result))

    def test_cross_scope_property_and_intake_link_block(self):
        """All known root/booking predicates must agree, not only one matched OR."""
        self.seed(booking=True,intake=True)
        self.sql(f"UPDATE booking_inbound_intake_events SET booking_id='{fixtures.B}' WHERE id='{I}';")
        result = self.observe_unchanged()
        self.assertIn("CROSS_SCOPE_ROWS",result["blockCodes"])
        self.assertEqual(result["bookingIds"],[])
        self.sql(f"UPDATE booking_inbound_intake_events SET booking_id='{B}' WHERE id='{I}'; UPDATE properties SET account_id='{fixtures.FOREIGN}' WHERE id='{P}';")
        result = self.observe_unchanged()
        self.assertIn("ROOT_IDENTITY_CONFLICT",result["blockCodes"])

    def test_indirect_graph_and_physical_rows_are_counted_without_claiming_ready(self):
        """Traverse foreign keys including indirect children, retaining actual counts."""
        self.seed(booking=True,intake=True)
        self.sql(f"INSERT INTO booking_ops_events VALUES ('{B}','{B}','private new event'); INSERT INTO booking_ops_domain_events VALUES ('{B}','{B}',NULL); INSERT INTO booking_ops_worker_tasks VALUES ('{B}','{B}','{B}'); INSERT INTO booking_ops_secure_task_links VALUES ('{B}','{B}');")
        for table in fixtures.PHYSICAL:
            self.sql(f"INSERT INTO {table}(id,booking_id,property_id) VALUES ('{B}','{B}','{P}');")
        result = self.observe_unchanged()
        self.assertEqual(result["tables"]["booking_ops_secure_task_links"]["incidentLinked"],1)
        self.assertEqual(result["tables"]["booking_physical_readiness"]["incidentLinked"],1)
        self.assertEqual(result["oldIncident"]["tables"]["booking_ops_events"]["incidentLinked"],24)
        self.assertIsNone(result["tables"]["payments"])
        self.assertEqual(result["externalEffectsObserved"],"NOT_INDEPENDENTLY_PROVEN")
        self.assertEqual(result["states"]["booking_physical_readiness"]["not_ready"],1)
        for table in fixtures.PHYSICAL:
            state = "approved" if table == "booking_physical_readiness" else "verified"
            self.sql(f"UPDATE {table} SET status='{state}' WHERE booking_id='{B}';")
        self.sql(f"UPDATE booking_physical_readiness SET final_ready=true WHERE booking_id='{B}';")
        result = self.observe_unchanged()
        self.assertEqual(result["states"]["booking_physical_readiness"]["approvedAndFinalReady"],1)
        self.assertEqual(result["fullPhysicalE2E"],"NOT_YET_PROVEN")
        self.sql(f"UPDATE booking_cleaning_tasks SET status='private-unknown-status' WHERE booking_id='{B}';")
        result = self.observe_unchanged()
        self.assertIn("UNKNOWN_STATE",result["blockCodes"])
        self.assertNotIn("private-unknown-status",json.dumps(result))

    def test_indirect_cross_tenant_parent_and_external_key_collision_block(self):
        """A graph member linked to an old/foreign parent is not silently adopted."""
        self.seed(booking=True,intake=True)
        self.sql(f"INSERT INTO booking_ops_worker_tasks VALUES ('{B}','{B}','{fixtures.EVENT}');")
        result = self.observe_unchanged()
        self.assertIn("CROSS_SCOPE_ROWS",result["blockCodes"])
        self.setUp();self.seed(booking=True,intake=True)
        self.sql(f"UPDATE booking_ops_records SET booking_id='retained-external' WHERE id='{fixtures.FOREIGN}';")
        self.assertIn("CROSS_SCOPE_ROWS",self.observe_unchanged()["blockCodes"])

    def test_old_identity_or_audit_drift_keeps_readonly_evidence(self):
        """Old data mismatches are reported alongside the new observation."""
        self.seed(booking=True)
        self.sql(f"UPDATE users SET email='private changed' WHERE id='{fixtures.U}';")
        result = self.observe_unchanged()
        self.assertIn("OLD_IDENTITY_CONFLICT",result["blockCodes"])
        self.assertEqual(result["tables"]["booking_ops_records"]["incidentLinked"],1)
        self.setUp();self.seed()
        self.sql(f"DELETE FROM booking_ops_events WHERE id=(SELECT id FROM booking_ops_events WHERE booking_ops_record_id='{fixtures.B}' LIMIT 1);")
        self.assertIn("OLD_EVIDENCE_COUNT_DRIFT",self.observe_unchanged()["blockCodes"])

    def test_read_only_denies_injected_write_and_schema_race(self):
        """Transaction enforcement and locked metadata checks protect both graphs."""
        self.seed(booking=True,intake=True)
        cat = self.catalog(); query = c.guarded_sql(cat,c.dep.schema_check(cat))
        before = self.snapshot()
        injected = query.replace("DO $guard$","UPDATE public.users SET email='bad'; DO $guard$",1)
        self.assertNotEqual(self.sql(injected,ok=False).returncode,0)
        self.assertEqual(before,self.snapshot())
        self.sql("ALTER TABLE booking_ops_events ADD COLUMN drift text;")
        try:
            self.assertNotEqual(self.sql(query,ok=False).returncode,0)
        finally:
            self.sql("ALTER TABLE booking_ops_events DROP COLUMN drift;")
        self.assertEqual(before,self.snapshot())

    def test_rls_denial_is_not_an_empty_graph(self):
        """Restricted row visibility must fail rather than hide evidence."""
        self.seed(booking=True,intake=True)
        names = ",".join(sorted(fixtures.ACTIVE))
        self.sql(f"GRANT USAGE ON SCHEMA public TO c4_dependency_denied; GRANT SELECT ON {names} TO c4_dependency_denied; ALTER TABLE booking_ops_events ENABLE ROW LEVEL SECURITY;")
        try:
            cat = self.catalog(); query = c.guarded_sql(cat,c.dep.schema_check(cat))
            result = self.sql("SET ROLE c4_dependency_denied;"+query,ok=False)
            self.assertNotEqual(result.returncode,0)
            self.assertIn(b"row-level security",result.stderr)
        finally:
            self.sql(f"ALTER TABLE booking_ops_events DISABLE ROW LEVEL SECURITY; REVOKE SELECT ON {names} FROM c4_dependency_denied; REVOKE USAGE ON SCHEMA public FROM c4_dependency_denied;")

    def test_unknown_dependency_blocks_before_data_query(self):
        """Unknown incoming FK metadata cannot expand the reviewed inventory."""
        self.sql("CREATE SCHEMA other; CREATE TABLE other.private_child(id uuid REFERENCES public.booking_ops_records(id));")
        try:
            with self.assertRaises(c.Block):
                self.witness()
        finally:
            self.sql("DROP TABLE other.private_child; DROP SCHEMA other;")


if __name__ == "__main__":
    unittest.main()
