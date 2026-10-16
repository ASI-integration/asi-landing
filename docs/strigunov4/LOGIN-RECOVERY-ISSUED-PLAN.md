# Isolated actual LOGIN verification — executed after parity handoff

Scope: recovery-issued lab credentials. These are newly generated recovery passwords for the isolated restored database. They do NOT prove recovery of original source passwords or external application credentials. No source connection or mutation is permitted.

## Actual result

Root approved scope; Astra explicitly completed parity and handed off container ID `ae57f850c5e4354753fe517f32629b4b8d97e1928f87e7dc8601dc626df80d09`. Process10272 exited0: all9LOGIN roles authenticated in fresh connections with recovery-issued passwords; all9wrong-password connections were rejected specifically as authentication failures. A fresh wrong-admin denial proved active SCRAM BEFORE positive checks. Role attributes/config/memberships remained unchanged; only passwords changed. HBA parse errors0; local SCRAM/hostreject now active in the isolated container.

Windows owner-only CMS bundle persisted and existing owner-key roundtrip verified before any password mutation. Cipher2681bytes, SHA256 `bfad7d4b33a26310fd1f9977ab919550174bfaa5da7f4d3b44212061871eb712`. No plaintext credential file created. Bundle path: `C:\Users\Admin\.asi\strigunov4-backup\login-credentials-2a7f58e4a68d4732816d4809b4207294-0e6c3636da75ba57\recovery-issued-lab-credentials.cms`.

Sanitized report: `C:\Users\Admin\.asi\strigunov4-backup\strigunov4-recovery-issued-login-38942690625.json`. HBA original SHA256 `056ad9accf7e1961052e549db6b4b03fc8480f12d358da0b4b221880e8e6fcec`; final SHA256 `739dbd6c909d7268b2d4721c0cbe305ae3910835195d3df4f860d7fc51829469`.

Roles: authenticator, pgbouncer, postgres, supabase_admin, supabase_auth_admin, supabase_etl_admin, supabase_read_only_user, supabase_replication_admin, supabase_storage_admin. Source original password recovery and external application credential recovery remain NOT_PROVEN; full restore acceptance remains NOT_PROVEN. Further maintenance must use the encrypted bundle through a private in-memory bridge; old trust access no longer works.

Implementation note: empty PGSERVICE causes libpq service lookup failure; the initial read-only inventory stopped without mutations. Corrected fixed shell launcher unsets PG overrides, keeping passwords only in subprocess environment and SQL only stdin. Four focused secret-channel/target/input tests passed. Password transaction disables pg_stat_statements tracking and statement/duration/sample/parameter/error-statement logging in the maintenance session. No values were printed into tool context or command argv.

## Fixed target / coordination

- WSL distro: `ASI-Strigunov4-Restore` (explicit, never default).
- Container: `asi-strigunov4-restore-2a7f58e4a68d-b`.
- Nonce: `2a7f58e4a68d4732816d4809b4207294`.
- Export run:38942690625; fixed archive digest already recorded.
- Image: `docker.io/supabase/postgres@sha256:5a4314708484bec672de2c09653a5c01fb1c84a998564ac231b0325e2238ed5b`.
- PG17.6, image postgres OS UID100/GID101, executables `/nix/var/nix/profiles/default/bin`.
- Wait for Astra's read-only parity tests to complete and root's explicit execution handoff. Never edit HBA concurrently with another acceptance process.
- Read-only inspect must match container ID (freeze ID after first inspection), labels for run+nonce, image digest, network none, no published ports, no unexpected mounts, and running state. Read actual label keys from established lab evidence, not guessed aliases. Refuse any mismatch.
- Obtain actual cluster data/socket/HBA paths from the accepted runtime evidence and read-only SQL; realpath must be inside that container's exact owned lab mount. No broad search, no external host, no source database URL.

## Discovery / baseline (read-only first)

Use the current trusted local maintenance connection inside this one container. Collect LOGIN role names and required metadata privately; no password column queries. Snapshot all roles' login/superuser/inherit/create-role/create-db/replication/bypassrls flags, connection limits, valid-until, configuration and role memberships before password changes. Record only sanitized role names/counts or a private canonical fingerprint in the public report.

Role list is exactly the roles having rolcanlogin=true in the restored cluster. Cross-check against restored globals and exclude nothing silently. A role with an expired valid-until, connection limit0, missing CONNECT, or unsuitable database session configuration may fail; record the precise sanitized category. Do not change attributes, expiry, memberships, database ACL or role config to manufacture successful login. Root/reviewer decides how to interpret provider-managed identities.

Verify logging settings before any password statement: log_statement=none, log_min_duration_statement=-1, log_duration=off and no pgaudit statement/parameter logging or log_statement_sample_rate path that would record statements. SQL errors must not dump statements containing values: use session-local log_min_error_statement=panic where supported. If these cannot be verified safely, stop before sending passwords. Do not print query text or subprocess error output. The database will store SCRAM verifiers as the intended effect; no application credential files are written.

## Closed credentials bundle BEFORE database mutation

1. On Windows, generate 32 random bytes per role using Python secrets, encode urlsafe for SQL-safe high entropy. Keep values only in process memory. Include target ID/image/nonce/run, credential purpose `recovery-issued lab credentials`, exact role list and schema version in JSON held in memory.
2. Verify existing recipient certificate SHA256 fingerprint equals the already pinned certificate. Existing owner private key remains Windows; never read its content into agent context or transfer it.
3. Encrypt JSON through OpenSSL stdin/stdout using existing public certificate, CMS DER AES256. Capture stderr privately. Persist ciphertext to a fresh exclusively created file in owner-only ACL recovery directory, no overwrite. Apply/verify owner-only ACL before writing; report directory/file identifiers and ciphertext SHA256 only.
4. Decrypt the persisted ciphertext using existing owner key via OpenSSL stdin/stdout; compare decoded content in memory with original using constant-time digest comparison and exact schema/role list checks. Wrong-key or readback mismatch blocks password changes. No plaintext JSON file is ever created. Clear references after completion; do not claim Python memory is securely erased.
5. Credential bundle durability, owner-key roundtrip and exact target binding are evidence. They establish recoverable lab-issued credentials only; `source_original_password_recovery=NOT_PROVEN` remains explicit.

## Mutation sequence (only after root handoff)

1. Recheck exact container ID/labels/mounts and role metadata baseline immediately before mutation; no drift tolerated.
2. Transfer credential JSON to explicit WSL receiver with Windows Python subprocess binary stdin, no shell or text pipeline. Receiver is reviewed nonsensitive code, not fetched code. It validates target binding and exact role list again. No /mnt/c mount or Windows interop required.
3. Begin one maintenance transaction. Set password_encryption=scram-sha-256 and audited no-statement-logging session settings. Send generated ALTER ROLE statements only via psql stdin, never argv. Quote role identifiers with doubled double quotes; values are generated urlsafe strings, not user-supplied SQL. ON_ERROR_STOP=1; capture output privately, return only success/fixed error category. Only PASSWORD is changed. Preserve all original flags/expiry/config/memberships. Commit only if all statements succeed; otherwise rollback.
4. Compare non-password role metadata and memberships with baseline. Any change aborts progression and is reported. Password rotation already committed cannot be claimed rolled back; keep durable recovery bundle and report actual state.
5. Save original lab HBA bytes in a private root-owned file (HBA is not a credential file); verify exact original digest and that no symlink is involved. Atomically replace only the admitted cluster's HBA with local SCRAM authentication and host reject rules. Preserve original file permissions/owner. No trust/peer exception for maintenance after the change. Reload only this container's postgres with exact pg_ctl path. Never restart another process or cluster.
6. Reload is asynchronous: poll bounded NEW wrong-password supabase_admin connections until narrowly recognized authentication rejection proves the old trust rule is no longer active; only then require a NEW correct-password admin connection and inspect pg_hba_file_rules. File parser checks and a successful reload exit alone are insufficient. The implemented recovery uses root's exact owned HBA backup plus pg_ctl reload inside this isolated container; it does not retain a maintenance connection. If recovery is requested, report active state as unproven until observed rather than claiming rollback succeeded merely because reload was invoked.

## Real connections and negative verification

For each exact LOGIN role, establish a NEW psql process and genuine connection through the Unix socket with correct generated password. Do not use SET ROLE as a substitute. Pass password through subprocess environment to `podman exec --env PGPASSWORD` (name only in argv, value inherited by Podman), then psql reads PGPASSWORD. Verify name-only Podman env forwarding with a NONSECRET synthetic variable first. If unsupported, do not fall back to --env PGPASSWORD=value or a plaintext pgpass file; revise the private stdin launcher under review.

Use a clean whitelisted environment; no inherited PGHOST/PGSERVICE/PGPASSFILE/PGPASSWORD. Explicit socket, port, database postgres and role; psql -X --no-password, ON_ERROR_STOP. Query current_user/session_user only and compare internally against expected role. Password values never enter tool outputs. Capture stdout/stderr in memory; never print them.

For each role create a NEW connection with a different high-entropy password and require actual authentication rejection (SQLSTATE28P01 if accessible; otherwise narrowly recognized libpq authentication failure plus correct target/HBA evidence). A generic nonzero return, missing executable, missing database, exhausted connection or timeout is NOT a successful negative test. Never echo bad password or full stderr. Ensure no .pgpass fallback by clean environment and nonexistent PGPASSFILE path/no-password prompting disabled.

After tests recheck exact role metadata/memberships and HBA digest/rules. Leave only this isolated cluster with the approved SCRAM configuration for independent review; no source credentials or key were changed. Root coordinates final lab cleanup and retention of the encrypted credential bundle.

## Evidence contract

Sanitized Windows backupdir JSON + scratch report:

- target distro/container ID/image/run/nonce;
- purpose `recovery-issued lab credentials`;
- encrypted bundle path/hash/bytes and owner-only ACL verification;
- bundle roundtrip successful (no content);
- exact LOGIN role names/count; actual per-role correct-login and wrong-password outcome;
- metadata/membership unchanged comparison;
- own-cluster HBA original/final digest and parse status;
- source_original_password_recovery=NOT_PROVEN;
- external_application_credential_recovery=NOT_PROVEN;
- full_restore_acceptance=NOT_PROVEN (independent review remains necessary).

No field `login_credentials_verified=true` or full RESTORE_PASS is emitted merely from plan completion. Actual results must support every assertion; reviewer decides whether lab-issued recovery credentials satisfy the intended backup acceptance scope.
