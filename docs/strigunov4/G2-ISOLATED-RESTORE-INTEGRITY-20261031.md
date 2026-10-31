# S4-G2 — offline application release backup/restore integrity

**Preparation only; not an authorization, backup creator, installer, migration, physical witness or stage transition.** This covers application release bytes, not the prior database restore. It creates/extracts nothing, uses no SQL, network or secret, and makes no live server change.

## Exact verified baseline (2026-10-31)

Protected main c037f1f939edcb571d5d22e6e1e92387e2ccadd8; canonical [G2 release handoff](G2-RELEASE-HANDOFF-20261028.md); merged PR #550 (do not repeat). Direct read-only Beget check: host pqukibofpo; staging asi-beget-g1-staging.service active PID 46657, G2 PostgREST PID 46644, the **existing** Engine PID 387356. The staging symlink remains at releases/d912aec6663de90e5ca4293cc5a69e2e0ed9ff94. G2 HTTPS /ru/connect returned HTTP 200, HTTP redirected 301; neither proves authenticated login or a new G2 deployment. PRs [#564](https://github.com/ASI-integration/asi-landing/pull/564), [#565](https://github.com/ASI-integration/asi-landing/pull/565) are source-only G2 witness tests, not physical acceptance.

## Isolated copy parity helper

After **separate, genuinely authorized** old-release backup and isolated restore preparation, an operator may compare two *existing disposable copies* and the independently pinned archive SHA. The expected backup digest must come from independently preserved backup custody, **not** from hashing whatever file is supplied to invent a trusted pin.

    python3 scripts/strigunov4/g2_isolated_restore_integrity.py \
      --source-copy /isolated-work/source-copy \
      --restored-copy /isolated-work/restore-copy \
      --backup-archive /isolated-work/verified-backup.tar.gz \
      --expected-backup-sha256 '<independently verified lowercase sha256>'

The verifier reports only file/directory/link counts and digests; rejects path overlaps, live protected paths, external/broken/escaping symlinks, hardlinks/special files, malformed or unequal backup hash, empty/oversized input, changed file/directory modes and unequal restored inventory. It records internal relative symlink targets as metadata without following them during the tree walk. A direct read-only inventory of the current G1 release found 41,788 regular files, 54 relative symlinks, zero broken links and zero hardlinked regular files; its size (~1.35 GB) fits the bounded verifier. This is an inventory observation, **not** backup/restore evidence. Even a positive result is G2_ISOLATED_COPIES_EQUAL_NOT_PHYSICAL_ACCEPTANCE with authorization=false, liveBackupProven=false, humanLoginProven=false and stageSwitched=false. This comparison cannot authenticate backup origin by itself.

Focused, offline synthetic test:

    python3 -m unittest discover -s scripts/strigunov4 -p 'test_g2_isolated_restore_integrity.py' -v

## Actual next G2 gates, in order

1. Fingerprint the **actual built** target artifact and protected reviewed source SHA, source-file inventory, target staging-only release path, installer/unit source, with no guessed hash.
2. Under real scoped authority capture a real old-release backup, immutable symlink/config metadata, trustworthy archive custody, isolated restoration and exact comparison; produce a **reviewed** one-service rollback plan. A historical archive or old symlink alone is insufficient.
3. Only under an independently effective artifact-bound stage grant switch the one named staging service; verify new version, health, PID/InvocationID, approved effective CRM/OPS membership, **all seven** effective no-send controls, denied anonymous CRM/OPS, kernel/provider no-send and a valid *human* operator login. Do not treat RU OTP/Yandex Draft #554 as deployed or a prerequisite when an existing approved login works.
4. G2 physical acceptance before G3 old-UNKNOWN no-replay/new IDs; then one G4 synthetic booking, G5 read-only UI/cross-account/no-send, G6 independent acceptance and separately approved READY_FOR_DEMO/publication.

Preserve NORMAL_OWNER_CONTROLLED and Issue [#551](https://github.com/ASI-integration/asi-landing/issues/551)'s release hold. No reviewer escalation or duplicate Engine, no merge/deploy/DB/credential/write to staging/production and no synthetic PASS declarations in this source-only lane.
