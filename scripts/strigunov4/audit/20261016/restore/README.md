# Historical isolated-restore execution records

These five files are audit records of the nonce-bound local rehearsal for backup run `38942690625`, nonce `2a7f58e4a68d4732816d4809b4207294`. They are **not a reusable executor**. Do not import, run, or discover them as tests in CI. They execute work at module top level and some mutate or remove exact owned containers, volumes, or database objects. Python assertions are safety checks; optimized execution would remove them. Publication is for source review only.

`execute_private_restore.py` records the successful second attempt, including guarded removal of the stopped first attempt. It reconciles exactly one bootstrap CREATE ROLE statement, then restores globals, database metadata, and the database. `verify_private_restore.py` checks metadata and initial anonymous denials. `compare_private_archive.py` compares archive data and schema privately. `reconcile_extension_owners.py` applies the reviewed 51-object owner correction and explicitly reports `original_acl_replay_done: false`. The subsequent exact original 51-ACL replay was a separate executed step documented in the result; it is not implemented by these five files. These files are therefore selected historical records, not a complete end-to-end replay bundle. `verify_acl_representation.py` reconstructs three ACL expectations in a separately owned sacrificial cluster and checks the remaining strict-schema differences.

The historical execution uses private `/prepared/globals.exec.sql`. The offline candidate's `globals.bootstrap.sql` is a distinct artifact; do not substitute one for the other or imply either contains unmodified globals. The immutable original `globals.sql` remains the hash-checked authority. The execution copy changes only the reviewed bootstrap statement; the result document records that exception.

The scripts assume historical local trust connections, existing private files, exact labels and earlier phases. The preserved target now uses SCRAM and recovery-issued lab passwords, so those connection assumptions no longer apply. Re-execution is neither needed nor authorized by publishing these records. Any future run needs a fresh reviewed target, admission and phase guards, and credential handling appropriate to its actual state.

Code inspection and targeted static scanning found no embedded passwords, JWTs, private keys, decrypted rows or credential-bearing connection URLs. The files contain local paths, object identities, immutable image/archive hashes and the public task nonce. They intentionally write raw SQL/data/output only to owner-only private local logs; those logs and input files must not be published. This assessment concerns these five source files, not an assurance about arbitrary adjacent files. Python syntax was checked with `ast.parse` without importing or executing them.

| File | Reviewed SHA-256 |
| --- | --- |
| `execute_private_restore.py` | `abb44052c3f6625897931fa5c4bef0dcd76005de1ee7f6ab8dd17021fe3f40fc` |
| `verify_private_restore.py` | `6cd7c975c8e6b80c5f3c883dc3da418a207bc904f8aeabfeecd14f10122a9aee` |
| `compare_private_archive.py` | `32edb08f5f9992c72a06e5799dc62af9861c0ab6e6dd225b7a3b1a24e979b595` |
| `reconcile_extension_owners.py` | `d36f839577c8fc0c6062b9ed5fa09f271829faf11e1a9046c492be3987b3e6c2` |
| `verify_acl_representation.py` | `c76d1c38151af69e0e5c6b1f90db2058284418db2b849244e189419b9f947a2f` |

See `RESTORE-EXECUTION-RESULT.md` for outcomes and explicit evidence limits. Neither successful import nor these historical scripts establish full security acceptance, original-password recovery, API session authorization, or live-service cutover readiness.
