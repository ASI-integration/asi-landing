# Isolated six-migration rollback rehearsal

Executed after root authorization on restored container `asi-strigunov4-restore-2a7f58e4a68d-b` (ID ae57f850c5e4354753fe517f32629b4b8d97e1928f87e7dc8601dc626df80d09), with private in-memory decryption of the recoverable lab-issued credentials. No source database connection and no production operations.

Process6380 exit0. Exact rehearsal SHA256 `9746958c643f0a29a384cfcce7fbeac5db067a26cdc16e12ec98319b48f747f4`, six source migrations; data-preflight SHA256 `5f3c655b832d357cc49cbae674c2fa1239f0d74901d0a88656e46937bc78b493`. Candidate read in full, final ROLLBACK/no COMMIT checked before sending; ON_ERROR_STOP retained. Native SQL completed and final ROLLBACK observed. Embedded assertions checked14required columns, seven preserved migration versions, runtime_bridge functions, disabled non-global send scopes and selected denied function privileges.

All6aggregate counts are zero: non-global scopes, intake booking/property backfill, ambiguous booking scopes, holds backfill, blocks backfill. This means the restored snapshot does not exercise nonempty data backfill paths; do not claim broad fixture coverage from these zeros.

Before/after native schema-only dump fingerprints match, normalizing only generated psql restrict/unrestrict keys: `a94722adc53dd49460f74856895df4d199e98d9d5bb5acb51fee99b1e741d1b1`. Complete ordered migration-history COPY fingerprint also unchanged: `651f56bd3f996817b26cbf7757983bed7c3e42c35e1bc55e624d7c9db580adad`.

Current communication-purpose constraint has29allowed literals; exact definition fingerprint `ba26895a8de9b4bc16c8790049ae81fa1f43dbc7871bf9800d050053aa26d1f7`. The separate optional purpose-repair migration was NOT included; its review can now compare the recorded literals against the candidate. No committed migrations or history registration occurred. The lab schema remains restored baseline after rollback. This is integration/rehearsal evidence, not protected staging apply approval, not G0 installation, and not full restore acceptance.

Sanitized evidence: MIGRATION-REHEARSAL-38942690625.json and LOGIN-VERIFICATION-38942690625.json in this directory. Private Windows report path: `C:\Users\Admin\.asi\strigunov4-backup\strigunov4-migration-rehearsal-38942690625.json`.
