# Strigunov4: full restore execution candidate

Status: CIPHERTEXT + DECRYPTION + ARCHIVE STRUCTURE VERIFIED; full restore NOT_RUN.
No database connection made and no restore executed.
Reviewed source: `88f5c353719db6a59c266a44ed4f1be80270103b`.
Export run `38942690625`: SUCCESS (job `117114029654`, independently checked by parent agent).
Ciphertext `strigunov4-staging-38942690625-1.tar.gz.cms`, 339054 bytes,
SHA256 `23f293fa6699061906823a6d28d1c7293c1e3e5d4fd147ae067437db4a6b6291`.
Downloaded via existing `asi-agent-verified` alias with BatchMode and StrictHostKeyChecking=yes to
`C:\Users\Admin\.asi\strigunov4-backup\strigunov4-staging-38942690625-1.tar.gz.cms`.
Remote Desktop Commander process 14952 exited 0; local SHA256 and size independently matched.
VPS ciphertext retained. Subsequent owner-key decryption was executed successfully in a private owner-only ACL temporary directory; exactly three regular archive members and PGDMP header verified without extraction or SQL/data output. Plaintext removed in finally; cleanup verified true. This is NOT pg_restore compatibility or full restoration proof.
Sanitized evidence: `C:\Users\Admin\.asi\strigunov4-backup\strigunov4-archive-verification-38942690625.json`.
Remote Desktop Commander process 11420 completed with key_decryption=PASS, archive_structure=PASS, plaintext_cleanup=true, restore=NOT_RUN, authorization=false.

Corrected private archive inventory (process 11160, supersedes 16416): pg_restore 17.11 --list PASS.
Archive has exactly **4** EXTENSION entries: pg_stat_statements, pgcrypto, supabase_vault, uuid-ossp.
The first parser incorrectly rejected hyphens and omitted uuid-ossp. Parser now accepts hyphens and fails closed unless the number of parsed names equals the number of EXTENSION entries; the archive was privately rechecked and sanitized report replaced.
Source catalogue has 5 extensions because plpgsql is also present there (1.0). The archive has no plpgsql EXTENSION entry. PostgreSQL installs plpgsql by default; this is not evidence of missing source data, but target plpgsql presence/version still must be checked after bootstrap. Do not treat the TOC's four entries as the complete source pg_extension catalogue.
TABLE DATA vault.secrets entry exists; extracting only vault data to a private temporary SQL file found exactly one COPY vault.secrets section with **0 rows**. No database connection or restore occurred. Other encrypted-column dependencies remain unverified: vault_n_a=false and vault_decryption=NOT_RUN. All plaintext removed, cleanup=true.
Sanitized evidence: `C:\Users\Admin\.asi\strigunov4-backup\strigunov4-archive-inventory-38942690625.json`.

## Runtime progress (16 October 2026)

After the initial discovery below, the dedicated owner-local `ASI-Strigunov4-Restore` WSL2 Ubuntu 24.04 distribution was installed successfully. The compatible database image and full restore are still pending. See RUNTIME-CANDIDATE.md and WSL-NEXT-ACTION.md for the installation evidence and remaining runtime work.

### Initial discovery before provisioning

- Windows device DESKTOP-I29K350: `wsl.exe --list --verbose` reports **no installed distributions**. The command existing does not establish a Linux runtime.
- Existing Windows Task12 test target is PostgreSQL 17 at loopback 55442; it is not a Supabase-compatible restore target (Vault unavailable per existing investigation).
- No docker/podman/qemu/multipass/VirtualBox command found on Windows; common Docker/Podman/VirtualBox executable locations absent. vmcompute service runs but provides no admitted distribution by itself. Scratch likewise has no Docker/Podman/QEMU/PostgreSQL commands available.
- Tailscale read-only inventory shows one Linux peer, `asi-agent-runner`, 100.116.142.101. No runtime-lab peer was present. This peer is NOT admitted for restoration: its separation from protected application infrastructure has not been established.
- SSH aliases alone are not evidence of lab isolation. No server connection, setup or installation was performed.

## Minimal viable route

Use a dedicated disposable Linux PostgreSQL17 cluster with the exact Supabase extension binaries required by the source catalogue, including supabase_vault. A pinned official Supabase PG17 image is the preferred candidate, but image digest, extension versions, root-key mechanism and blank-cluster bootstrap must be verified before executing. Do NOT claim that stock postgres:17 or a Supabase image started with default initialization is sufficient.

Run only the database component: no Auth, REST gateway, workers, SMTP, cron execution or outbound webhooks. No public ports; preferably network=none plus local Unix socket for restore and verification. Bind only the dedicated restore directory and disposable data directory. No host Docker socket inside the DB container, no application paths, no production credentials. Pin the image by independently verified digest; do not guess a digest or use latest.

A fresh hosted Supabase project or a default self-hosted stack is not a drop-in target for the raw custom dump: managed roles and objects already exist and may prohibit original ownership. Provider cloning can copy Vault root keys but does NOT prove that this newly exported archive is recoverable. Do not silently replace the archive under test with a provider clone or a filtered CLI dump.

## Exact admission prerequisites

1. Protected export run success and its encrypted SHA256/size; independently download ciphertext to owner laptop and compare SHA256. Keep VPS copy. Encrypted copy durability is separate from restore evidence.
2. Owner private CMS key is recoverable via its approved local protected path. Do not print/read its value into agent context, do not upload it to GitHub, do not create a new key to replace missing recovery material.
3. Admit an exact disposable host/container identity, PG major 17, extension versions, mount/network allowlist, free-space budget, and cleanup ownership. A new WSL distribution/Docker installation or a new hosted project is an infrastructure action, not an already available capability.
4. Obtain secure approved restoration source for required LOGIN credentials. Export uses --no-role-passwords. Generated throwaway passwords prove role authentication mechanics only, not recovery of original application credentials.
5. Establish source Vault row count and encrypted-column usage without returning plaintext. If nonempty, root key must be provisioned using the provider-supported mechanism into the isolated target. Never rotate/change the source key. If empty, document source and restored zero rows and absence of other encrypted-column dependencies; N/A is explicit, not fabricated success.
6. Preserve the 7 known extra migration-history versions; do not use the production schema as replacement.

## Restore protocol (execute only after prerequisites)

1. Create owned private staging directory (0700 Linux or equivalent owner-only Windows ACL) with fresh run identifier. Disable shell tracing and SQL echo. Capture all command output in private files; report only fixed status categories/counts. Never upload plaintext dumps/logs as Actions artifacts.
2. Verify ciphertext SHA256 against protected export evidence BEFORE decryption. CMS AES256 encryption here is not an authenticated archive format; digest provenance therefore matters. Decrypt with the existing owner's key locally, with subprocess output captured. Reject failure.
3. Inspect tar members before extraction: exactly db.dump, globals.sql, toc.txt; each a regular file; reject absolute/traversal paths, symlinks, hardlinks, duplicate names and oversize payloads. Verify PGDMP magic and `pg_restore --list` exit 0. Keep original ciphertext unchanged.
4. Determine globals/bootstrap compatibility in a fresh empty cluster with a uniquely named temporary restore-administrator role absent from source globals. Do not replay globals blindly over a running Supabase service cluster. Ensure no conflicting postgres role/database/bootstrap objects. Configure extensions using reviewed version-matched bootstrap. Every required exception must be specified by exact object and final invariant; generic ignore-errors is forbidden.
5. Restore globals with psql -X --set ON_ERROR_STOP=1 and full ownership/role attributes/memberships. Restore custom archive with pg_restore --exit-on-error --single-transaction against an admitted empty database. Never use --no-owner, --no-acl, blanket SQL filtering, --clean against a reused database or ignored return codes. Where extension-managed objects require initialization, reconcile exact dependencies before rerun on a fresh target; keep failures as failures.
6. Disable executable external channels at OS boundary before restore, including extension background workers and cron. Restored credentials and jobs are real data even when the app is not running. During data import, prevent double-encryption triggers where applicable using reviewed session-local settings; restore normal trigger behaviour afterwards and verify it.
7. Compare restored metadata against the original archive plus source snapshot: schemas, extension names+versions, all objects/owners, role attributes/memberships, relation/column/function/schema/sequence ACL, default privileges, RLS enabled+forced flags and policy expressions, SECURITY DEFINER/function search_path, triggers, constraints+validation, indexes, sequences, publications, migration history. Do not rely on ACL string existence in toc.txt.
8. Verify all table data via private deterministic row counts and keyed digests; never print row data or secret hashes. Snapshot consistency matters: current exporter does not include a catalogue manifest tied to the pg_dump snapshot, and globals are exported separately. Freeze concurrent schema/role/data changes during verification or explicitly close this evidence gap before declaring equality. A later live snapshot cannot silently stand in for the dump-time baseline.
9. Provision approved required LOGIN credentials into target only, then use separate genuine database connections to test correct login and reject wrong password. SET ROLE alone is not login verification. Do not start application services using copied credentials.
10. Verify Vault by forcing evaluation of every restored decrypted_secret in a private transaction and returning only count + boolean. count(*) alone can avoid evaluating decrypt expression. Compare source/restored counts, and compare privately computed keyed digests if appropriate; no plaintext or unkeyed low-entropy secret hash in logs. Wrong-key/corruption negative test occurs in a separate disposable copy, never by changing source or known-good restore root key.
11. Run negative authorization cases using real limited LOGIN connections: anonymous denied private tables/functions/Vault; authenticated tenant A cannot SELECT/INSERT/UPDATE/DELETE tenant B fixture; UPDATE cannot change ownership; direct forbidden RPC denied; revoked operator/session denied where the application contract requires it. Fixtures only on restore target, deterministic ownership, transaction rollback/cleanup. Test existing policies rather than inventing new policies to make tests pass. Expected-denial SQLSTATE or zero-row outcome must be explicit, not any failure.
12. Independent reviewer verifies exact archive digest, target identity, commands, captured exit statuses, all object/data/security comparisons, key/credential proof and clean-up. Report RESTORE_PASS only when every required gate is proven. This plan creates no evidence booleans.

## Stop / cleanup

Any missing extension, wrong PG major, unsupported owner, absent credential, decrypt failure, changed target, metadata/data mismatch, unexpected outbound path or raw SQL error blocks migrations. Destroy only explicitly owned disposable cluster/container/volumes after evidence recorded and owner retention rule satisfied. Preserve encrypted copies and reviewable sanitized evidence. Never drop a reused database or delete a broadly matched directory.

No migration or G0 installation is authorized by this plan. Next existing contract remains scripts/strigunov4/preflight.py; it requires true independent restore evidence, not plan completion.

## Official sources checked

- https://supabase.com/docs/guides/self-hosting/postgres-upgrade-17 — PG17 compatible images and separate root-key volume.
- https://supabase.com/docs/guides/self-hosting/restore-from-platform — raw pg_dump includes internal objects unlike filtered CLI dump; passwords/Storage external dependencies; restore incompatibility warnings. Its generic filtering workarounds do not satisfy our full-owner/full-ACL gate.
- https://supabase.com/docs/guides/platform/migrating-within-supabase/backup-restore — managed role differences, LOGIN credential recovery, migration history and external storage.
- https://supabase.com/docs/guides/database/vault — root key is separate from PostgreSQL data; provider key portability endpoint. API requests were not executed.

The changelog markdown endpoint was requested but the web fetcher rejected its content type; relevant current official topic pages were checked instead. Documentation does not prove compatibility with our source catalogue.
