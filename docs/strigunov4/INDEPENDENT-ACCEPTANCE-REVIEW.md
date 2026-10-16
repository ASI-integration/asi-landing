# Independent restore acceptance review

**Independent judgment: RESTORE_PASS for the bounded logical archive recovery required by the merged `SECURE-STAGING-BACKUP.md`.** The immutable backup from run `38942690625` was recovered in the admitted isolated target, and the required available object/data/security, recoverable LOGIN and negative-access evidence is complete. The final 64 fresh limited-role LOGIN-chain checks passed, with schema/history/COPY values/all four sequences unchanged. No required archive-acceptance gate remains unproven within this stated scope.

**Independent minimal-SQL verdict: accepted for a separately authorized staging change proposal—six default migrations plus the narrowly justified purpose repair as an unapplied seventh migration.** Both rollback rehearsals passed; actual restored history confirms version `20260810280000` absent. This verdict does not execute or authorize live staging DDL, systemd changes, G0 installation or deployment.

## Approved acceptance scope

The approved policy deliberately exports globals without password hashes. It requires a confirmed closed credential source for each required LOGIN role and actual successful login after restore, not original-password recovery. The owner-encrypted recovery-issued bundle and nine successful fresh LOGIN tests, paired with nine wrong-password denials, satisfy that requirement. Reviewed code persists and verifies encrypted recovery before password mutation, suppresses statement/parameter tracking in the password session, keeps passwords out of command arguments, verifies active SCRAM, and preserves nonpassword role attributes/memberships. No blocking discrepancy was found in the successful path.

Documented source-catalog/archive/restored empty Vault supports the policy's explicit narrow N/A. It does not claim arbitrary application ciphertext was decrypted. External application/session/provider secrets and running HTTP/worker integrations remain deployment prerequisites, not automatic extra archive gates.

## Restore evidence reviewed

- Owner-key decryption and immutable archive/input hashes; isolated PG17.6 pinned Supabase image, nonroot container, no network/ports, read-only root and 512 MiB cap.
- Roles, attributes, memberships and grantors; original database creation properties/owner/ACL; all available archive schemas; owner/ACL/RLS/default-grant definitions; exact five extensions including Vault; migration history and all seven staging-only versions.
- All 182 archive COPY headers and 873 row values match, ignoring only physical row order; four sequence states match. The apparent 183rd table is `realtime.messages`, observed as a partitioned parent with zero children and zero rows, so no ordinary table data was omitted.
- Exact reviewed bootstrap-role reconciliation, followed by narrow 51 extension-member owner corrections and original ACL replay. Strict schema differences remain explicitly bounded to 15 equivalent contiguous default-GRANT reorderings and three extension initial-privilege representations; the three actual owner/grantor/grantee/privilege/grantable ACL sets match supported reconstruction. No system-catalog edits or broad SQL normalization.
- Negative tests deny anon access to private auth/Vault; the synthetic tenant suite denies client table/RPC access and verifies service-role cross-account alert, actor membership, stale revision, mismatched INSERT, revoked membership and reassigned property ownership failures, followed by valid A acknowledgement with B unchanged.

The source does not grant authenticated table access to the protected tables. Own-tenant client read success is therefore not an appropriate positive control; no grants/RLS were changed to manufacture it. SET LOCAL ROLE tests are labeled authorization tests. The final receipt `ROLECHAIN-VERIFICATION-38942690625.json` records 64 separate fresh authenticator LOGIN sessions, each proving session_user=authenticator and current_user=anon/authenticated before SELECT/INSERT/UPDATE/DELETE for each of four protected tables and both A/B account scopes. All 64 produced exactly SQLSTATE42501; full before/after schema/history/COPY/sequence state matched. This is real limited-LOGIN role-chain evidence of table ACL denial, not an invented own-tenant read permission or HTTP/JWT tenant-policy claim.

## Historical failure, explicit correction, successful rerun

The first tenant run's assertions passed, but preservation correctly BLOCKED because `booking_ops_records.asi_reference` has a nextval default. Two successful synthetic INSERTs and one rejected INSERT advanced `public.asi_reservation_reference_seq` from 100007/true to 100010/true despite rollback. The original failed report is preserved.

A separately reviewed local correction verified the original four-sequence hash, exact sole difference, target identity, absence of other client backends and immediate current value, then restored only that sequence to 100007/true. All four original values were verified afterward. This was explicit reconciliation, not a claim that rollback undid nextval.

The revised fixture supplies explicit synthetic asi_reference values on all three INSERTs. Its actual rerun passed every assertion with schema/history/COPY/sequence fingerprints unchanged. Revised fixture SHA-256 `9efdc243d15c3c1f3a921176633c2a37ca64649c1a3b5c84557bd29d7d68bd88`; original `9e14022d36ce2317df10b75ff861dccae52d65af9b28728acec7d0d8c9a549c7` remains in `tenant_authorization_fixtures.original.sql`.

## Minimal SQL and purpose repair

The six default migrations passed rollback-only rehearsal. Their builder's one-way history/function checks alone are not complete equality proofs; the actual bridge additionally compared full before/after schema/history/data/sequence state.

The optional purpose repair exactly matches all 42 canonical values, in order, from `BOOKING_OPS_COMMUNICATION_PURPOSES` at source `334d93fc39d2ea51ba283dd0314bbc239ff49707`, `src/lib/booking-ops/types.ts`. Existing 29 values are retained; precisely 13 missing canonical values are added. This is a specific compatibility correction, not arbitrary widening.

The optional repair also passed a separate rollback-only rehearsal. Its actual validated CHECK definition was copied unchanged to a temporary purpose-only table; all 42 values were inserted and an unknown value was rejected with SQLSTATE23514 and the exact constraint name. All schema/history/COPY/sequence fingerprints were unchanged. This proves the tested predicate, not full communication-intent workflow or external sending. Fixture SHA-256 `b67e464cdd6003127534fe3e20e770d3a7215b38bdd69c24d982f04c794115e5`.

Version `20260810280000` is absent from actual restored migration history, confirmed in the final role-chain receipt, as well as the earlier source catalog. It may therefore be proposed as the unapplied seventh migration rather than a replay of recorded history. The six-default-plus-one proposal preserves all seven staging-only versions and performs no history rewrite. None has been committed to staging by these rehearsals.

## Deployment boundaries and audit artifacts

The reviewed alerts PATCH route derives account and actor from the server session, not request-body overrides. Real HTTP tests for A-session/B-alert spoofing and revoked live sessions belong to G0 application acceptance. Booking scope INSERT protection does not establish universal service-role UPDATE isolation; the acknowledgement RPC's current-owner recheck was tested separately. Multi-session lock races, worker crash/restart and provider behavior are also separate application gates.

The five historical execution scripts contain no embedded credentials found by code review/targeted scanning; they are nonce-bound records, not an importable CI executor. The separate original 51-ACL replay is not implemented by those five files, and no replacement source was fabricated. See `scripts/strigunov4/audit/20261016/restore/README.md` for exact hashes and limitations. A bounded archive RESTORE_PASS does not itself authorize live staging DDL, systemd changes, G0 installation or deployment.
