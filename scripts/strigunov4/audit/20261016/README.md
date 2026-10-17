# Isolated recovery audit helpers

These are historical, target-bound helpers for backup run 38942690625, not a general deployment or restore interface. The owner-side manifest, encrypted credentials, private key, source archive and raw logs are deliberately absent. Do not repoint these helpers to another database or execute them in CI.

`lab_login_windows.py` and `lab_login_receiver.py` record recovery-issued credentials and genuine SCRAM login checks. `lab_rehearsal_windows.py` records the exact six-migration rollback rehearsal using only in-memory decryption. Its SQL input files correspond to the hashes in `scripts/strigunov4/candidates`; the private execution layout also contained the admitted target manifest. These records are not a self-contained rerun package.

Only `test_lab_login_receiver.py` is an offline test: it mocks process calls and tests secret channels, foreign-target rejection and environment isolation. The `restore/` subdirectory contains earlier executed restoration records with stronger top-level execution warnings. Never import those modules in CI.

Sanitized evidence and limits are under `docs/strigunov4/`. Original source passwords, external application credentials and full restore acceptance are not proven by these helpers.
