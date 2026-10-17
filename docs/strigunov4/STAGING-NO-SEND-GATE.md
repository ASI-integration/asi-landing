# Strigunov 4 — protected staging no-send configuration

This is a **single staging configuration operation**, separate from migration execution or installing G0. It is designed for the existing protected GitHub `staging` environment, which already requires the owner's approval and limits deployment branches to `main`. It does not weaken any existing protection or enable real outbound actions.

## Strict scope

- On `pull_request`, run credential-free Linux unit tests only.
- On explicitly confirmed `workflow_dispatch` from exact current protected `main`, with exact reviewed source SHA, owner login and ID, single first run attempt and a separate GitHub staging reviewer approval, access the staging SSH key. Check a pinned ED25519 host fingerprint and use only the staging identity `project_ayfaar`.
- On target `asi-agent-runner`, under `sudo -n`, require the existing systemd unit digest, `asi-runtime` user/group, old staging release SHA `5c91b27bcde395f01cc078d1fbe454dd7436e1c6`, responsive localhost health and version, and all six already-effective outbound-safety flags before any change.
- Modify **only** `/var/www/asi-staging/shared/.env.staging.local`: append exactly `ASI_SYNTHETIC_NO_SEND=YES` without altering any existing byte. Refuse a conflicting or duplicate flag. Before replacement, require a regular nonsymlink file, mode `0640`, observed UID `1001` and GID `1000`. Persist a private `0600` copy under a root-owned `0700` evidence directory; update the original atomically with identical owner, group and mode. Use a root-only nonblocking lock and a run-ID/SHA-bound one-time directory to prevent concurrent or replayed use.
- Restart **only** `asi-landing-staging`, then verify the original release is still active and healthy and all **seven effective process flags** have the required values. No successful result until the actual new process carries the flag.
- On postwrite or restart failures, attempt atomic restoration of the original settings and old runtime health. Return a distinct manual-recovery block if a safe rollback cannot be established. Do not include the environment file contents, private keys or application secrets in logs.
- **No SQL, staging migration history, release extraction, G0 activation, Production, Sentinel, Telegram, email, WhatsApp, OTA or payments.** Restarting the existing staging service causes a brief availability interruption.

## Review and operation boundaries

The host-side script cannot itself prove a GitHub review merely from strings on the command line; the **protected GitHub environment with secrets** is the external authorization boundary. The workflow checks all context fields and uses pinned source code from the reviewed `main` checkout, transmitted to the host over fingerprint-pinned SSH. The host refuses an unreviewed live-release or unit drift.

The environment file currently has six expected safety-key entries, `ASI_SYNTHETIC_NO_SEND` is missing, and mode `0640` / UID `1001` / GID `1000` have been observed read-only. After source review and protected merge into main, a **separate owner-reviewed manual run** is required to make this configuration effective. Existing preflight and encrypted-backup runs awaiting approval are distinct and cannot be silently approved by this source change.

Unit tests: `python3 -m unittest discover -s scripts/strigunov4 -p test_staging_no_send_patch.py -v` and `python3 -m unittest discover -s scripts/strigunov4 -p test_protected_staging_no_send.py -v`.

**Pilot remains NOT_LIVE** until fresh database backup/recovery acceptance, independent nine-SQL protected apply/history registration, verified G0 systemd activation, and physical synthetic end-to-end operation with zero external sends.
