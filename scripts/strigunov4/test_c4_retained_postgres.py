"""Actual PG17 full-row invariants, using the established isolated fixture schema."""
import json
import os
import unittest
import test_c4_dependency_postgres as fixtures
import c4_retention_evidence as evidence


@unittest.skipUnless(os.environ.get('C4_DEPENDENCY_ISOLATED_PG')=='1','isolated opt-in absent')
class RetentionPostgresTests(unittest.TestCase):
    setUpClass=classmethod(fixtures.DependencyPostgresTests.setUpClass.__func__)
    tearDownClass=classmethod(fixtures.DependencyPostgresTests.tearDownClass.__func__)
    sql=classmethod(fixtures.DependencyPostgresTests.sql.__func__)
    setUp=fixtures.DependencyPostgresTests.setUp
    catalog=fixtures.DependencyPostgresTests.catalog
    snapshot=fixtures.DependencyPostgresTests.snapshot

    def witness(self):
        catalog=self.catalog()
        missing=evidence.dep.schema_check(catalog)
        data=json.loads(self.sql(evidence.snapshot_sql(catalog,missing)).stdout)
        return evidence.validate_snapshot(data,missing)

    def test_readonly_stable_all_columns_and_private(self):
        rows=self.snapshot();first=self.witness()
        evidence.unchanged(first,self.witness())
        self.assertEqual(rows,self.snapshot())
        self.assertNotIn('PRIVATE MESSAGE',json.dumps(first))
        self.assertNotIn(fixtures.U,json.dumps(first))
        self.sql(f"UPDATE booking_ops_events SET payload='altered' WHERE booking_ops_record_id='{fixtures.B}';")
        with self.assertRaisesRegex(evidence.dep.Block,'OLD_EVIDENCE_CHANGED'):
            evidence.unchanged(first,self.witness())

    def test_deletion_and_insertion_fail_known_counts(self):
        self.sql(f"DELETE FROM booking_ops_events WHERE id=(SELECT id FROM booking_ops_events WHERE booking_ops_record_id='{fixtures.B}' LIMIT 1);")
        with self.assertRaisesRegex(evidence.dep.Block,'OLD_EVIDENCE_COUNT'):self.witness()
        self.setUp()
        self.sql(f"INSERT INTO booking_ops_events VALUES ('11111111-1111-4111-8111-111111111111','{fixtures.B}','extra');")
        with self.assertRaisesRegex(evidence.dep.Block,'OLD_EVIDENCE_COUNT'):self.witness()

    def test_indirect_child_mutation_and_foreign_exclusion(self):
        first=self.witness()
        self.sql(f"UPDATE users SET email='different@example.invalid' WHERE id='{fixtures.FOREIGN}';")
        evidence.unchanged(first,self.witness())
        self.sql(f"DELETE FROM booking_ops_worker_link_audit WHERE id='{fixtures.AUDIT}';")
        with self.assertRaises(evidence.dep.Block):evidence.unchanged(first,self.witness())

    def test_cross_scope_and_unknown_trigger_fail_before_hash(self):
        self.sql(f"INSERT INTO booking_ops_worker_tasks VALUES ('{fixtures.FOREIGN}','{fixtures.FOREIGN}','{fixtures.EVENT}');")
        with self.assertRaisesRegex(evidence.dep.Block,'OLD_SCOPE_BLOCK'):self.witness()
        self.setUp()
        self.sql('CREATE TRIGGER unknown BEFORE INSERT ON booking_ops_records FOR EACH ROW EXECUTE FUNCTION booking_ops_record_insert_scope_guard_v1();')
        try:
            with self.assertRaisesRegex(evidence.dep.Block,'TRIGGER_DRIFT'):self.witness()
        finally:self.sql('DROP TRIGGER unknown ON booking_ops_records;')

    def test_readonly_denial_and_schema_race(self):
        cat=self.catalog();query=evidence.snapshot_sql(cat,evidence.dep.schema_check(cat))
        before=self.snapshot()
        injected=query.replace('DO $guard$',"UPDATE public.users SET email='bad'; DO $guard$",1)
        self.assertNotEqual(self.sql(injected,ok=False).returncode,0)
        self.assertEqual(before,self.snapshot())
        self.sql('ALTER TABLE booking_ops_events ADD COLUMN drift text;')
        try:self.assertNotEqual(self.sql(query,ok=False).returncode,0)
        finally:self.sql('ALTER TABLE booking_ops_events DROP COLUMN drift;')
        self.assertNotEqual(self.sql('SET ROLE c4_dependency_denied;'+query,ok=False).returncode,0)

    def test_new_graph_separate_and_old_unchanged(self):
        old=self.witness();plan=evidence.PLAN
        u,a,p=(plan[k] for k in ('userId','accountId','propertyId'))
        b='12121212-1212-4212-8212-121212121212';i='13131313-1313-4313-8313-131313131313'
        owned={k:plan[k] for k in ('userId','accountId','propertyId')}
        owned.update(bookingIds=[b],intakeIds=[i],runId='123456789')
        self.sql(f"INSERT INTO users VALUES ('{u}','{plan['email']}'); INSERT INTO accounts VALUES ('{a}','C4 staging isolated account 123456789'); INSERT INTO properties VALUES ('{p}','{a}','C4 isolated property 123456789'); INSERT INTO booking_ops_records VALUES ('{b}','{a}','{p}','fresh-external','C4 synthetic guest 123456789',NULL); INSERT INTO booking_inbound_intake_events VALUES ('{i}','{a}','{p}','{b}'); INSERT INTO booking_ops_events VALUES ('{b}','{b}','NEW PRIVATE SYNTHETIC');")
        for t in fixtures.PHYSICAL:self.sql(f"INSERT INTO {t} VALUES ('{b}','{b}','{p}');")
        cat=self.catalog();missing=evidence.dep.schema_check(cat)
        query=evidence.scope_new_query(evidence.snapshot_sql(cat,missing),owned)
        new=evidence.validate_snapshot(json.loads(self.sql(query).stdout),missing,new_fixture=True)
        self.assertEqual(new['counts']['booking_ops_events']['incidentLinked'],1)
        evidence.unchanged(old,self.witness())
        self.sql(f"INSERT INTO booking_ops_worker_tasks VALUES ('{b}','{b}','{fixtures.EVENT}');")
        with self.assertRaisesRegex(evidence.dep.Block,'OLD_SCOPE_BLOCK'):
            evidence.validate_snapshot(json.loads(self.sql(query).stdout),missing,new_fixture=True)


if __name__=='__main__':unittest.main()
