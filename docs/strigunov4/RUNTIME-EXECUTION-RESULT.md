# Dedicated restore runtime: actual execution

2026-10-16. Device DESKTOP-I29K350 (de94fcdf-2d67-4e33-a1a3-bf92d79dd374). Target is only ASI-Strigunov4-Restore, installed at C:\Users\Admin\.asi\strigunov4-restore-wsl.

## Completed

1. WSL scoped install process10788 exit0,135.20s: `wsl.exe --install Ubuntu-24.04 --name ASI-Strigunov4-Restore --location 'C:\Users\Admin\.asi\strigunov4-restore-wsl' --version 2 --vhd-size 12GB --no-launch --web-download`. No previous distributions, first became default. No WSL upgrade/reboot/elevation/global config.
2. First boot process11116 exit0: Ubuntu24.04.5, UID0 only for distro setup. Root filesystem12,573,614,080bytes;10,603,016,192available. Linux memory3196MiB available;1024MiB swap unused.
3. Preserved original `/etc/wsl.conf` as `/etc/wsl.conf.before-strigunov4-isolation`. Kept `[boot] systemd=true`; appended `[automount] enabled=false` and `[interop] enabled=false, appendWindowsPath=false`. Initial process2312 exited1 because PowerShell stdin transport appended CR to final cat argument; inspection572 confirmed config and backup correct. No malformed files found. Targeted terminate/restart10232 succeeded, /mnt/c mount absent and WSLInterop binfmt absent: ISOLATION_CHECK_PASS. Never invoked global wsl --shutdown.
4. `apt-get update` completed exit0 within10232, official Ubuntu repositories. Simulation12360 showed19new packages,0upgrades,22.0MB downloads,99.1MB added disk. Explicit --assume-no preview aborted as expected; no package mutation during preview.
5. Install17260 exit0,24.69s: `apt-get --yes --no-install-recommends install podman uidmap slirp4netns fuse-overlayfs`, DEBIAN_FRONTEND=noninteractive, within named distro only. Podman4.9.3 (package4.9.3+ds1-1ubuntu0.2). Disabled newly installed podman auto-update service/timer, restart, clean-transient, API service/socket. Verified API socket/service and auto-update timer inactive and disabled. No Windows-wide engine.
6. Post-install disk10,170,195,968bytes available; Linux memory3311MiB available, swap unused.
7. Remote official registry manifest lookup12224 exit0 for `docker.io/supabase/postgres:17.6.1.136` selected linux/amd64 digest `sha256:5a4314708484bec672de2c09653a5c01fb1c84a998564ac231b0325e2238ed5b`. Podman manifest inspect for this single-image digest cannot parse single-image manifests; this failed attempt was NOT claimed success. Direct HTTPS registry inspection4560 then exited0: independently hashed manifest and config bytes, matched digest and config `sha256:f519727303f0af6862882be2a30f420e28710d4209226e681aaddb2c01d12d9b`;29layers totaling367,203,535compressed bytes. Public registry token stayed in process memory, not output. Config architectureamd64/oslinux, default User=null (root), entrypoint docker-entrypoint.sh. Explicit nonroot UID and entrypoint overrides required.

## Pinned image and empty cluster results

8. Pinned pull14548 completed exit0/118.25s. Local image IDf519727303f0af6862882be2a30f420e28710d4209226e681aaddb2c01d12d9b; manifest digest unchanged, local expanded size1,270,449,153bytes. PG binary version17.6. Image postgres UID100/GID101. Binaries `/nix/var/nix/profiles/default/bin/{postgres,initdb,pg_ctl,psql,pg_config}`; extension directory `/nix/var/nix/profiles/default/share/postgresql/extension`.
9. Read-only nonroot inspection matched controls plpgsql1.0,pg_stat_statements1.11,uuid-ossp1.1,pgcrypto1.3,supabase_vault0.3.1. An initial guessed alternative extension-directory ls failed; corrected using pg_config --sharedir. Direct Vault0.3.1.sql inspection failed because package installs0.3.0.sql plus0.3.0--0.3.1.sql; actual chain inspected6604 exit0. Default image config preloads pg_cron/pg_net/pgsodium and other extras: NOT used. Bundled pgsodium_getkey.sh creates a random root key when absent: NOT used. Vault GUC wiring in default config is vault.getkey_script, separate from pgsodium.getkey_script.
10. Created sole named volume `asi-strigunov4-emptyprobe-20261016`, label `asi.task=strigunov4-emptyprobe-20261016`. Sacrificial container with same name/label, `--rm --network=none --read-only --user 100:101 --cap-drop=ALL --security-opt=no-new-privileges --memory=512m --pids-limit=128 --volume asi-strigunov4-emptyprobe-20261016:/lab:U --entrypoint /bin/sh`, exact digest above. No ports, host paths, backup, keys, or credentials mounted. Engine is rootful only inside this dedicated WSL distro; container process nonroot. Rootless engine was NOT tested/claimed.
11. Direct initdb succeeded with unique administrator and source-compatible ICU locale. PG started with only pg_stat_statements preload, no TCP listener and0logical replication workers. pg_available_extension_versions returned all5exact versions. Four CREATE EXTENSION statements committed successfully; plpgsql already installed by initdb. Vault row count0; pg_stat_statements callable. Initial final metadata query used obsolete daticulocale and failed with SQLSTATE undefined_column; process344 exit3, trap stopped server. This was not ignored or called PASS.
12. Corrected metadata query used PG17 datlocale; process12316 read-only verification returned all5versions, UTF8/provideri/en_US.UTF-8/en-US, exact preload pg_stat_statements, max_logical_replication_workers0, blank listen_addresses. Only non-pg_* role was asi_emptyprobe_20261016, confirming no default postgres/Supabase role conflicts. Vault key-loader setting absent and `/etc/postgresql-custom/pgsodium_root.key` absent. Corrected probe exit0; server stopped. No encrypted values were tested, and no source Vault decrypt proof is claimed.
13. Cleanup16820 exit0: verified exact volume name+label and zero matching containers, removed only that volume, verified it absent. Local pinned image retained with Containers0. Available filesystem8,779,698,176bytes (~8.18GiB), memory3260MiB available, swapunused. Distro remains running for next scoped work; no database remains.

## Tested empty bootstrap commands

These commands describe the sacrificial run only. Actual restoration must use a NEW owned target and source globals/database owner/ACL/SET metadata. Do not recreate extensions before pg_restore blindly; the archive owns their creation. Do not claim a unique-admin-owned probe database preserves source postgres ownership.

```sh
initdb -D /lab/data -U asi_emptyprobe_20261016 --auth=trust --encoding=UTF8 --locale-provider=icu --locale=en_US.UTF-8 --icu-locale=en-US
pg_ctl -D /lab/data -l /lab/postgres.log -o "-k /lab -c listen_addresses='' -c shared_preload_libraries=pg_stat_statements -c max_logical_replication_workers=0 -c shared_buffers=32MB" -w start
psql -X -h /lab -U asi_emptyprobe_20261016 -d postgres -v ON_ERROR_STOP=1
```

```sql
BEGIN;
CREATE EXTENSION pg_stat_statements VERSION '1.11';
CREATE EXTENSION "uuid-ossp" VERSION '1.1';
CREATE EXTENSION pgcrypto VERSION '1.3';
CREATE EXTENSION supabase_vault VERSION '0.3.1';
COMMIT;
SELECT extname,extversion FROM pg_extension ORDER BY extname;
SELECT datname,pg_get_userbyid(datdba),pg_encoding_to_char(encoding),datlocprovider,datcollate,datctype,datlocale FROM pg_database WHERE datname='postgres';
```

Trust authentication was confined to the empty probe's private Unix socket. It is NOT evidence of recovered LOGIN credentials or acceptable final authentication. Full restore must configure/test proper authentication separately. No backup imported; full restore NOT_RUN.
