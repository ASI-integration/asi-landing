# Scoped WSL next action, verified 2026-10-16

Read-only checks on DESKTOP-I29K350, device de94fcdf-2d67-4e33-a1a3-bf92d79dd374, completed successfully. UPDATE: parent subsequently authorized and this exact installation completed successfully; see result below.

- WSL 2.7.11.0; kernel 6.18.33.2-2; default version 2; HypervisorPresent true.
- No installed distributions, including unfinished registrations reported by --list --all.
- Ubuntu-24.04 appears in --list --online.
- Installed help supports --name, --location, --version, --vhd-size, --no-launch, --web-download.
- Destination does not exist.
- C: free 29,960,781,824 bytes, approximately 27.90 GiB.
- Physical RAM total 8,195,153,920 bytes; available 1,314,060 KiB at inspection. Image/restore execution must fit this constrained memory or wait for capacity. Do not terminate unrelated workloads.

Runnable provisioning step (parent may execute under existing task authorization):

```powershell
wsl.exe --install Ubuntu-24.04 --name ASI-Strigunov4-Restore --location 'C:\Users\Admin\.asi\strigunov4-restore-wsl' --version 2 --vhd-size 12GB --no-launch --web-download
```

This creates one specifically named distro with a 12GB virtual disk ceiling, downloads through WSL's official distribution path, and avoids launching its shell automatically. No existing default distro can be replaced because none exists; first registration may automatically become the default. Do not claim default state remains absent. No --update, --set-default, --shutdown, Windows feature enablement, Docker Desktop installation, or reboot is included. If WSL reports a required feature/reboot, record the actual error and stop rather than changing host features silently.

After successful registration, inspect `wsl.exe --list --verbose`; launch only this named distro for an innocuous version/id check. Engine installation can remain inside this disposable distro using rootless Podman, not a Windows-wide engine. That engine step is NOT executed or version-validated here. Before plaintext is introduced, disable distro Windows-drive automount and Windows executable interoperability via its own /etc/wsl.conf; terminate only this named distro and verify after restart. Container must still use network none and tightly scoped mounts. These steps do not require modifying global .wslconfig. Default WSL host mounts are not an acceptable full-restore boundary.

Source catalogue is already available in migration-preparation/catalog.json: plpgsql1.0, pg_stat_statements1.11, uuid-ossp1.1, pgcrypto1.3, supabase_vault0.3.1. No pgsodium extension is listed. Therefore no pgsodium extension-role bootstrap is required by present source evidence. Vault root-key loader remains required if encrypted rows exist. Matching pinned image availability must still be checked.

Installation rollback is scoped to this new distro only. `wsl.exe --terminate ASI-Strigunov4-Restore` stops it; unregistering deletes all its data and requires checking that this exact registration is task-owned and that retained encrypted backup/evidence are outside it. Do not unregister other names or delete a parent directory.

Official reference verified: https://learn.microsoft.com/en-us/windows/wsl/basic-commands. Installed local help is authoritative for the newer name and vhd-size flags. Read-only tool processes: 7148 and 4536, both completed.

## Executed result

Process10788 completed exit0 after135.20s: Ubuntu24.04 downloaded and distribution successfully installed. Verification process3752 exited0: sole distro ASI-Strigunov4-Restore, Stopped, version2; WSL2.7.11.0 unchanged. It became default because no distro existed. Exact destination exists with ext4.vhdx1,413,480,448bytes. C: remaining28,505,567,232bytes and available memory1,074,564KiB. No reboot/elevation/global config/engine/DB start. No distro shell boot was invoked. 12GB cap was passed to installer; independent Linux filesystem-size verification awaits narrowly scoped first boot.
