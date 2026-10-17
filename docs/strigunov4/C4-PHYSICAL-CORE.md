# Strigunov4 C4 physical staging core — protected execution contract

**Source-only until approved. Never treat this package as full C4 acceptance by itself.**

## Already proven
- G0 live on `asi-landing-staging`, localhost:3001: source `d912aec6663de90e5ca4293cc5a69e2e0ed9ff94`, protected activation [39036303529](https://github.com/ASI-integration/asi-landing/actions/runs/39036303529).
- Nine staging migrations history `postgres|17|99|7|9`, protected apply [39031172658](https://github.com/ASI-integration/asi-landing/actions/runs/39031172658).
- C4 isolated native full scenario: 29/29 PASS, 0 external connections, exact cleanup; staging-only read-only probe PASS [39040347972](https://github.com/ASI-integration/asi-landing/actions/runs/39040347972).
- Independently observed stage systemd process with `staging-acceptance@asi.local` in both operator and admin allowlists; that email did not exist in staging `users` at the time of the read-only inspection. Recheck on every run, never assume forever.

## New physical core
1. GitHub must review source and Linux CI before protected `main` merge. Owner must start exact-sha-bound first-attempt `workflow_dispatch` and approve the `staging` environment, **not** production.
2. New GH `staging` secrets must already contain precisely `STAGING_SUPABASE_URL`, `STAGING_SUPABASE_SERVICE_ROLE_KEY`, `STAGING_SESSION_SECRET` (in addition to existing stage PG+SSH secrets). If any are missing, stop before all live writes. **Never copy credentials through chat, a PR, the laptop, a log or a public GitHub artifact.** These secrets must match only the existing staging app.
3. Run exact existing SQL-history PG17/TLS `verify-full` read-only check and the independently reviewed G0 host probe (actual symlink, unit checksum, exact process/PID, 7 effective no-send flags, 5 unauthenticated route checks).
4. Open a pinned SSH tunnel to the existing stage service port 3001, with owner-only private temporary SSH credentials. No staging application restart, release mutation, migration, Vercel write or Production/Sentinel action.
5. The core runner uses only stage-scoped GitHub secrets, and creates a single **new** random UUID user/account/property, using `staging-acceptance@asi.local` only after proving there is no existing user with that email. Real source G0 receives authenticated HTTP intake with guest email under `example.invalid` and one booking reference bound to the workflow run ID. No genuine guest, phone, OTA, provider or payment credentials.
6. Read back and verify own booking `account_id` and `property_id`, replay identical intake (no second booking), verify operator Booking Ops list and authorized CRM route, and assert zero `sent` / `sending` communication intents for the fixture. No fake `mark_as_sent` actions.
7. Cleanup strictly by known owned UUIDs, never `LIKE`, `ILIKE`, shared prefix, global truncate or customer-contact matching. Verify the synthetic account, user, membership, property and booking are absent after cleanup. On unknown receipt or cleanup failure, **BLOCK** and require read-only reconciliation; never blindly rerun. Automatic process restarts and global cleanup are prohibited.
8. Postflight stage no-send and exact G0 identity are rechecked. Success status is `C4_PHYSICAL_CORE_PASS`, not `READY FOR SUPERVISED STRIGUNOV DEMO`.

## Honest limits / safety
- This initial physical core establishes a real staging HTTP -> booking -> stage DB record and operator readback, idempotent retry and scoped cleanup. It **does not** yet prove the full operator alert acknowledgment, two-connection reservation contention in the live Supabase tenant, guest communication deliverability or live provider network egress.
- Existing isolated C4 proves worker crash/recovery, concurrency, owner isolation and seven blocked provider/payment boundaries. These facts are not magically converted into physical-stage evidence.
- A no-send flag and no sent intents are **not** independent real-world proof of zero provider egress. The project must continue to keep external sending disabled for this test and for any demonstration until separately assessed.
- If schema constraints reject exact-ID cleanup or a stage secret is missing, record one precise `BLOCK`; do not weaken authorization, switch projects, update unrelated rows or silently broaden deletion.

**User goal:** finish the first usable Strigunov staging pilot as quickly as safety permits, without new product features, branch renames, external sends or Production/Sentinel changes.
