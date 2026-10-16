# Astra: isolated PG17 runtime candidate

2026-10-16 update: scoped owner-local WSL installation SUCCEEDED under explicit parent authorization, process 10788, exit 0, runtime135.20s. No image pulled, no SQL executed. Full restore NOT_RUN. Owner-side archive decryption/structure success is separate evidence.

Exact executed command:
`wsl.exe --install Ubuntu-24.04 --name ASI-Strigunov4-Restore --location 'C:\Users\Admin\.asi\strigunov4-restore-wsl' --version 2 --vhd-size 12GB --no-launch --web-download`

Verification process3752 exited0: ASI-Strigunov4-Restore is the sole distro, STOPPED, WSL2; it became default because none existed. WSL version remains2.7.11.0. Dedicated path exists, ext4.vhdx physical file1,413,480,448bytes. Remaining C:28,505,567,232bytes (~26.55GiB), available memory1,074,564KiB (~1.02GiB). No reboot, elevation, global configuration, engine installation or database start occurred. No distro shell was started. The virtual disk cap was specified to WSL but filesystem capacity is not yet independently checked inside Linux. See WSL-NEXT-ACTION.md for exact read-only observations.

Next narrow candidate: boot ONLY this named distro as root for `id`, `/etc/os-release`, `df`, `free`, and inspect its /etc/wsl.conf; then configure only distro-local host automount/interoperability isolation before introducing plaintext. Check apt package metadata/download/disk estimate before installing Podman inside the distro. Current ~1.02GiB free Windows memory warrants a measured first boot and no simultaneous image pull or database start. No global WSL memory config or Windows-wide engine is necessary for this route. Container rootless capability and source-extension match remain unverified.

## Original infrastructure rationale (superseded by successful WSL install above)

Admit a new local Linux lab on the owner's Windows device, isolated from the existing native PG17 Task12 cluster: a dedicated WSL2 distribution plus a Linux container engine is the preferred no-cloud-project route. Installation may require elevation/reboot and disk space. Existing WSL executable with zero distributions is not an installed lab. Do not use asi-agent-runner, staging, existing database ports, or a hosted Supabase project to bypass this requirement.

If the owner instead supplies an already disposable Linux host with a container engine, that avoids installing WSL. It must have an exact admitted identity and cleanup scope. Neither target exists in the evidence currently supplied. This is the first missing execution capability, not a SQL patch.

On that lab, pull only an official `supabase/postgres` PG17 image, resolve and record its platform-specific immutable digest, then disconnect the database container's network. Official compose currently names `supabase/postgres:17.6.1.136`; this is a discovery candidate, NOT a verified compatible pin. The source extension catalogue must select the final image. No digest has been guessed.

## Container contract for review

Use `network_mode: none`, no published ports, no other Supabase services, no host engine socket, non-root image postgres UID verified from that exact image, `cap_drop: ALL`, no-new-privileges, read-only root filesystem, and private writable data/socket/log directories. Mount only the new owned lab directories; archive/key inputs are read-only and private. Explicit resource/disk budget and cleanup owner are required. Unix socket clients run through container exec, so no TCP listener is needed. Password authentication can be tested over Unix sockets using explicit SCRAM rules.

Override the image entrypoint. Do NOT run its standard Supabase initialization/migration scripts. Invoke image PG17 `initdb` directly with `--username=<unique_restore_admin>` into a brand-new directory. Read that image's executable paths using `command -v`/`pg_config`; do not assume Linux package layout. Run `postgres` against initdb's configuration with explicit network, socket and preload settings. This retains Supabase binaries without precreating Supabase database objects.

Before importing secrets, run a sacrificial *empty* cluster to inventory `pg_available_extension_versions`, binary PostgreSQL version, image platform/digest, and extension install scripts. Compare every required version and prerequisite with private source evidence. No compatible-image claim until this succeeds.

## Empty bootstrap and exact conflicts

1. Choose bootstrap administrator absent from source globals and extension install scripts. `initdb --username` prevents a preexisting `postgres` role, so globals can create original roles with original attributes/memberships. PostgreSQL predefined `pg_*` roles still exist and must be treated as version-owned, not deleted.
2. `initdb` creates postgres/template0/template1 databases and built-in public/plpgsql objects. The source custom archive's database entry, encoding, locale provider/collation and database ACL must be inspected. Restore into a fresh template0-derived database with exact reviewed source properties; do not use `pg_restore --create` blindly against existing postgres. If the dump requires name `postgres`, explicitly replace only that disposable lab's bootstrap postgres database from a separate maintenance database, after ownership of the target is proven. This is not permission to drop any current database.
3. Replay unmodified globals with ON_ERROR_STOP. Inspect tablespace statements before replay; reject host paths unless individually mapped and reviewed. Do not strip statements or ignore duplicate roles.
4. Extension installation may itself CREATE ROLE (notably pgsodium-related roles) or assume Supabase owner roles. Replaying globals first can therefore still collide. Read exact pinned extension SQL before deciding ordering. An exact object-specific bootstrap recipe is required; do not precreate extensions broadly, suppress duplicate-object errors, or remove role statements globally. Preserve final owners/ACLs and every role attribute/membership. This remains unverified until the decrypted inventory and image scripts are available.
5. Extension preloads must be minimal and source-driven. No cron scheduler, pg_net worker, subscription apply worker, or logical worker may execute restored workloads. `network=none` alone does not prevent local cron SQL. When a required extension cannot install without preload, explicitly configure its documented disabled-worker mode and verify it before import. Start with no preloads and max_logical_replication_workers=0; don't treat that as a universal extension recipe.
6. Restore with pg_restore --exit-on-error --single-transaction, ownership and ACL enabled. Plaintext SQL and failure logs remain private. Then run all gates from RESTORE-EXECUTION-PLAN.md. This candidate does not produce RESTORE_PASS.

## Vault root key: distinct from CMS owner key

CMS private key success proves archive decryption only. Vault's project root key is absent from the logical dump. Official Supabase documentation supplies a GET management endpoint `/v1/projects/{ref}/pgsodium` for active projects and documents a 64-character hex root key. The PUT variant changes a project's root key: do not call PUT on the source.

If source Vault/encrypted columns contain data, securely export the existing source root key directly into an owner-only local file using approved credentials and no terminal/log/tool output. No root-key retrieval was performed here. Do not supply a newly generated key. Official self-hosted docs identify `/etc/postgresql-custom/pgsodium_root.key` as the persistent key file, separate from PGDATA. The exact pinned image's getkey script and Vault/pgsodium GUC integration must be inspected: a custom initdb bootstrap bypasses standard image wiring, so simply mounting that filename does NOT prove the key is loaded. Verify file format, ownership, and key-loader config without printing contents; evaluate restored decryption privately and return only count/boolean.

If both Vault and all other root-key-dependent usage are proven empty, document that explicit N/A. A successful SELECT count(*) on the decrypted view is insufficient because PostgreSQL may skip decryption. Use an evaluation-forcing aggregate or private procedure over decrypted_secret; wrong-key test belongs in a separate disposable copy.

## Remaining admission facts

- Dedicated WSL2 distro now installed and stopped. Distro-local container engine and PG17 image are not yet installed/admitted.
- Source versions verified from migration-preparation/catalog.json: plpgsql1.0, pg_stat_statements1.11, uuid-ossp1.1, pgcrypto1.3, supabase_vault0.3.1. No pgsodium extension; pgsodium-role concern above is generic and not a requirement for this source. Locale, pinned-image manifest and matching scripts remain to verify.
- Vault root-key recovery if encrypted data exists; original required LOGIN credential recovery (globals omitted passwords).
- Dump-time baseline consistency for complete metadata/data verification, as already recorded in the parent restore plan.

## Official sources checked

- https://raw.githubusercontent.com/supabase/supabase/master/docker/docker-compose.yml — current image tag; standard compose runs initialization/migrations and separate db-config volume.
- https://supabase.com/docs/guides/self-hosting/postgres-upgrade-17 — PG17 image/config differences and separate persistent root key.
- https://supabase.com/docs/guides/database/vault — key location and GET/PUT portability API.
- https://www.postgresql.org/docs/17/app-initdb.html — selectable bootstrap superuser and initial databases.

Supabase skill read. Changelog markdown fetch attempted but rejected by web fetcher content-type; relevant official topic pages verified. Current compose is not an immutable source and does not prove source catalogue compatibility.
