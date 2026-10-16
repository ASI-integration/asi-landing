# Strigunov4 actual archive restoration and verification

2026-10-16. This records executed results, not a proposal. The archived database was restored successfully into an isolated local target. Subsequent LOGIN, tenant, role-chain and preservation checks support independently reviewed **RESTORE_PASS within the approved logical archive scope**. See INDEPENDENT-ACCEPTANCE-REVIEW.md for the final judgment. Phase-specific pending/false statements below describe the earlier handoff, not the final acceptance. Original source passwords were intentionally excluded; recoverable lab-issued credentials satisfy the approved LOGIN requirement.

## Archive and target identity

- Protected export run38942690625; ciphertext SHA256 `23f293fa6699061906823a6d28d1c7293c1e3e5d4fd147ae067437db4a6b6291`.
- Owner-side CMS decryption, strict archive validation, binary transfer and target input hashes were verified before database work. CMS key stayed on Windows. Immutable inputs: db.dump1,287,642bytes SHA256 `c53aac07cfe623a0f0f1306a9144c319cbaaa679ad1c8a52beb07f63cf336c92`; globals.sql5,519bytes SHA256 `f708fb1cdccf47d0675e80b8b550edebb32b41ecad1a51337b4b8c5a9948b27c`. Both UID100:GID101,0600, private0700directory.
- WSL target only: ASI-Strigunov4-Restore on DESKTOP-I29K350. Host automount/interoperability disabled. No staging/production connection or mutation.
- Container `asi-strigunov4-restore-2a7f58e4a68d-b`, ID `ae57f850c5e4354753fe517f32629b4b8d97e1928f87e7dc8601dc626df80d09`; label `asi.task=2a7f58e4a68d4732816d4809b4207294`.
- Image `docker.io/supabase/postgres@sha256:5a4314708484bec672de2c09653a5c01fb1c84a998564ac231b0325e2238ed5b`, PG17.6; process UID100:GID101, networknone, no published ports,512MiB limit, read-only root filesystem, all capabilities dropped, no-new-privileges. Default image entrypoint and key generator bypassed.
- Exact owned volume `asi-strigunov4-restore-2a7f58e4a68d-b-data` at /lab. Only additional binds /input and /prepared, both read-only. No host drive, container-engine socket, private CMS key, or unrelated application path mounted.
- Target remains running for further scoped tests. /lab/data PGDATA, /lab Unix socket, port5432 not network-exposed. No source-root-key helper used.

## Initial failure and reviewed bootstrap reconciliation

The initial unique-bootstrap-role attempt failed globals replay at line112, SQLSTATE42501: source membership grantor supabase_admin was not the target bootstrap role. PostgreSQL17 requires a recorded membership grantor to hold ADMIN OPTION unless it is the bootstrap superuser; merely being another SUPERUSER does not satisfy this exception. Entire globals transaction rolled back; only one nonbuilt-in role remained. Failed container stopped and was removed with its exact labelled empty volume after identity checks. Private failure logs retained.

Parent reviewed and authorized a specific adaptation, then a NEW cluster was initialized with supabase_admin as OID10. Original globals remained byte-identical. A private execution copy replaced exactly one standalone `CREATE ROLE supabase_admin;` with a fail-closed assertion of current_user=supabase_admin, roleOID10 and superuser. Reversing that replacement reproduces original bytes exactly. All original ALTER ROLE, memberships and GRANTED BY statements remained unchanged; no artificial grants or ignored errors.

Derived execution-copy SHA256: `657ebc733cec05f684c58368cfc2f68f8352f2676cd0f7816af94b915b262678`.

Official rule checked: https://www.postgresql.org/docs/17/sql-grant.html (GRANT on roles, GRANTED BY/bootstrap-superuser exception).

## Actual restore execution

Process10836 exited0 after22.16s. Every phase exited0:

1. Input hashes/permissions, new target identity, UID/network/memory/rootfs guards.
2. Direct initdb: UTF8, ICU provider, en_US.UTF-8, ICUen-US; only pg_stat_statements preload,0logical replication workers, blank listen_addresses.
3. Reviewed globals execution copy: psql -X, ON_ERROR_STOP=1, single transaction.
4. Original archive TOC7282DATABASE/7283COMMENT/7284ACL/7285DATABASEPROPERTIES selected and rendered with pg_restore --schema-only --create. Only this fresh cluster's bootstrap postgres database was dropped after owner/identity checks; original database creation/owner/ACL/settings replayed outside a transaction from maintenance template1.
5. Full original archive: pg_restore --exit-on-error --single-transaction into postgres, ownership and ACL enabled. No --no-owner, --no-acl, error suppression or data filtering.

Command implementation is execute_private_restore.py. All SQL/data/stdout/stderr were captured in owner-only local files; sanitized statuses only returned.

## Observed metadata and source-globals equality

Databasepostgres ownerpostgres, UTF8/provideri, en_US.UTF-8/en-US,5databaseACL entries. Exact extension versions: plpgsql1.0,pg_stat_statements1.11,uuid-ossp1.1,pgcrypto1.3,supabase_vault0.3.1. Extension objects themselves are owned by supabase_admin in the target; source extension ownership is not asserted where archive metadata does not establish it.

15role-name CREATE statements,31ALTER ROLE attributes/settings statements and18membership GRANT statements including grantors exactly matched a fresh password-free globals redump. No leftover probe/unique-admin roles.

183tables;188relations with ACL;24default ACL rows;0column ACL rows;168RLS-enabled relations;140RLS-forced relations;144policies. Migration history90rows. All seven staging-only versions retained:20260729040307,20260729040309,20260729040332,20260913120838,20260913120856,20260913120921,20260913120945. Vault secrets count0. Empty Vault is not source-root-key recovery/decryption evidence.

## Archive data equality

Read-only inspection of the already-private archive COPY map found storage.objects0rows, storage.buckets0rows and vault.secrets0rows. Thus this archive contains no Storage object/bucket metadata requiring external object recovery. This does not assert anything about unreferenced external objects. Exactly five source extensions were confirmed; pgsodium is not installed. A bounded scan of visible archive schema SQL found no qualified pgsodium dependency, and Vault references only in the Vault extension's own ACL entries. Arbitrary application ciphertext or dynamically constructed dependencies are not ruled out; no blanket encryption N/A is claimed.

Original archive data-only render and restored database data-only export were handled privately. All182COPY table/column headers matched exactly. Every table's row count matched, and per-table sorted COPY row UTF8 bytes matched for all873rows. Only physical row order was ignored; values were not normalized or exposed. All4sequence SETVAL statements matched exactly. The catalogue reports183tables while the archive contains182COPY blocks; these are different measures. Data equality covers every182archiveCOPY block. Subsequent observed metadata resolves the extra relation: realtime.messages is an empty partitioned parent with zero children and zero rows (RESTORE-COVERAGE-38942690625.json).

The first data render command omitted an explicit output file and failed; corrected read-only render used --file=-. Failed attempt recorded, no database mutation.

## Owner mismatch found and corrected

Successful pg_restore initially left51extension-member objects owned by supabase_admin whereas original archive ACL headers identify ownerpostgres. This was a real mismatch, not hidden by normalization.

Parent authorized an exact object-specific reconciliation. Private/sanitized manifest recorded each signature/schema/currentowner/expectedowner, actual extension dependency and original ACL TOC ID/hash. All51objects verified as members of pg_stat_statements(5),pgcrypto(36),uuid-ossp(10), all currentowner supabase_admin. One transaction applied narrowly generated ALTER FUNCTION/VIEW OWNER TOpostgres, with per-object dependency/owner assertions. No schema-wide/extension-wide ownership change.

Exact original51ACL TOC entries were then replayed unchanged in one transaction because the post-owner-change render still exposed three pg_stat_statements ACL differences. Selection-list SHA256 `1c684727a6bd590a01981496c11361d749bb1802fdf835fd0cb164d7c565d40b`. Source archive untouched. No system catalogue or pg_init_privs writes.

## Schema comparison and bounded ACL representation exceptions

Strict text equality remains false:191diff lines after removing only random restrict/unrestrict tokens and dump-version comment headers. These remaining differences were explicitly resolved semantically, not broadly stripped:

- 1834other schema blocks byte-identical, including definitions/owners/RLS/policies/ACL statements outside identified exceptions.
- 15default-ACL blocks contain identical complete GRANT statement multisets keyed by owner/schema/object kind, only reordered. Comparison permits only a contiguous GRANT run, preserves every other byte and REVOKE order; no broad statement sorting.
- 3pg_stat_statements ACL blocks differ because extension initial-privilege baseline records the original installation owner. For resetfunction and2views, a separate fresh isolated same-image cluster installed pg_stat_statements1.11 as archive-member-ownerpostgres and replayed the unchanged original three ACL entries. All36expanded final ACL tuples—owner,grantor,grantee,privilege,grantability—matched the actual restored target. This is a supported reconstruction of the expected installation context, not an assertion that source extension-level ownership was archived.

The expectation cluster and exact labelled volume were removed after verification. pg_init_privs remained untouched. Semantic schema comparison passed within these explicitly documented bounds; exact schema text equality is not claimed.

## Negative authorization and handoff

Two rollback-only cases, SELECTconstant from auth.users and vault.secrets after SET LOCAL ROLEanon, both failed with expected SQLSTATE42501. No table data returned. These prove these two SQL authorization denials only; they are not real LOGIN verification or a complete tenant fixture suite.

Read-only archive parity work completed before handoff to restore_preparation for separately authorized recovery-issued SCRAM credentials. Actual container identity/settings were supplied. No passwords/HBA changed by this agent. At handoff, socket authentication was still private lab trust; pg_stat_statements.tracktop and log_min_error_statementerror were explicitly reported for suppression before credential operations.

## Remaining limitations

- Source-original LOGIN credential recovery not proven; recovery-issued credential checks are separate work.
- Full tenant A/B, ownership-reassignment, RPC and revoked-session negative cases remain separate.
- Built-in plpgsql and extension-level ownership not established by absent source archive metadata must not be invented.
- Earlier live source catalogue is auxiliary evidence, not silently substituted for dump-time evidence.
- Archive and globals were exported separately; exact equality to both restored artifacts does not prove they came from one atomic source snapshot.
- No migrations/G0 execution or production change occurred. Full security RESTORE_PASS remains false.

Sanitized local reports and private logs reside under the owned nonce-specific restore directory. Scripts for review: execute_private_restore.py, verify_private_restore.py, compare_private_archive.py, reconcile_extension_owners.py, verify_acl_representation.py.
