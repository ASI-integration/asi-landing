# G2-only release handoff

Preparation only. No Engine/Dispatcher dependency, merge, deployment, login, role change or G2 acceptance.

## Integration identity and scope
Base: c7e100d384b33822a91146824ef88199c68329bd.
Google baseline: #542 46b7816dbb860110cc08572779e6b8bbbe7bb494. The session test stays byte-identical; the component and its tests have only the verified #550 concurrency and narrow-screen fixes.
Witness source: #544 babb08d856b99b7bd421fddff5e261df253d48b5, reconciled as described below.
No Engine #549 files, CI redesign, migration, product features or canonical stage status changes.
The two existing PR approvals remain historical valid approvals of their exact HEADs; never request them again. They do not authorize this changed witness or protected actions.

#544's historical GIS fixture/test is intentionally not included: it reproduces an obsolete callback bug. Acceptance uses the real-component regressions from #542, extended for #550 findings. The historical evidence stays in #544.

## Witness binding
The only policy path remains /etc/asi-g2-witness-policy.json. Fixed host pqukibofpo, fixed unit asi-beget-g1-staging.service and existing trusted-file/ownership checks remain.
Policy now requires exactly release (40 lowercase hex), unitHash (64 lowercase hex), pid, invocation, crm and ops. Old four-field policies fail closed. Release/unit identity is also included in the strict redacted receipt.
No runtime discovery creates or approves policy. The protected operator must independently bind the reviewed deployed artifact to the actual process, and the owner-approved CRM/OPS membership sets. CRM includes OPERATOR_EMAIL. Never derive approved membership from whichever environment happens to exist.
After switch/restart, capture actual PID/InvocationID; the independently approved policy must match these actual values. No old PID or release constant is a fallback. A subsequent process change requires a new reviewed binding; old receipts remain historical.

## Source checks
Targeted: 19 GIS component tests and 19 witness tests (two focused files). These use mocked browser/OS inputs and are not physical acceptance. Full TypeScript and touched-file ESLint are separate checks. GitHub exact integration HEAD CI/governance must be terminal and independently verified before protected integration; green source tests alone are insufficient.
Verified #550 findings addressed: private policy mode before read; loaded systemd fragment/drop-in validation; reciprocal email/GIS single-flight guard; measured button width with ResizeObserver and a genuine compact Google button for hosts below 200px. Tests cover private/readable policy, non-root UID 65534, file substitution, missing/foreign systemd properties, policy reread race, both authentication directions, resize and cleanup. No session API, auth payload or redirect behavior is changed.
Independent CodeRabbit must review the final exact integration SHA. The original source approvals do not cover this new delta. Offline tests do not establish Firefox login, native policy ownership or production layout.

## Protected operations, in order
1. Independently verify effective main protection and exact integration HEAD checks/review. Obtain one explicit, SHA-bound integration decision. Existing scope comments are not merge grants. Keep original PR branches unchanged; do not merge both originals again after the consolidated integration.
2. After authorized integration, record resulting actual main commit and build artifact SHA256/file inventory. PR preview merge SHA, tree SHA and a proposed commit are not interchangeable. No final deployable artifact is asserted before it exists.
3. Freeze G2-only deployment manifest: pqukibofpo / 31.129.96.181; unit asi-beget-g1-staging.service; /var/www/asi-staging/current and a named new /var/www/asi-staging/releases/<actual-release>; existing env path /var/www/asi-staging/shared/.env.staging.local is preserved. No unit/environment/allowlist changes unless individually included in the eventual grant. Enumerate installer/witness/policy paths and hashes before their installation.
4. Verify backup of only changed link/artifact/config metadata, exact old release bytes and SHA256, and isolated restore. Current observed old release d912aec6663de90e5ca4293cc5a69e2e0ed9ff94 is not itself a verified backup. Missing backup => no apply.
5. Under a valid artifact-bound staging deployment/rollback grant: one staging switch, only named-service restart, health/version check. No migrations, database writes/cleanup, OAuth changes, firewall relaxation, production, Sentinel, observer or Engine changes.
6. Protected witness installation/run uses reviewed source/interpreter/transport, no arbitrary commands/forwarding. Root-owned private policy (0600 or stricter; no group/other access) with exact approved memberships. The witness requires FragmentPath=/etc/systemd/system/asi-beget-g1-staging.service and an empty DropInPaths; missing or nonempty properties block. Do not delete a discovered drop-in to make a witness pass: stop and review its authorization. Require native ownership/symlink/race negatives and provenance of each read-only receipt. Independently check existing no-send ingress/egress protections for the same process interval.
7. Verify both effective allowlists plus EMAIL_AUTO_SEND=false, EMAIL_DRAFT_ONLY=true, DRY_RUN_TELEGRAM_OUTBOUND=true, ALLOW_REAL_TELEGRAM_SYNTHETIC=false, YOOKASSA_ENABLED=false, ASI_SYNTHETIC_NO_SEND=YES, ASI_APP_ROOT=/var/www/asi-staging/current. Confirm anonymous CRM/OPS API401. A reachable page shell or old G1 proof cannot substitute.
8. Human step, only on verified target: Firefox https://g2.asi-global.ru/ru/connect, approved operator manually clicks visible Google button. Verify intended session and /dashboard/crm/queue and /dashboard/booking-ops. Include auth/session/user/account effects in human-login authority. No bookings/sends/payments. Keep cookies, tokens and personal account details out of reports. Check denied roles with existing authorized identities only.
9. Bind source, artifact, host, policy, current process, time, independent witness and human result. Then obtain explicit physical acceptance/stage-transition decision and update canonical map through its protected process. Only a verified G2 ACCEPTED permits G3 selection.

## Rollback and unknown outcome
The deployment grant must separately authorize return of the exact verified prior artifact/link and named-service restart. Preserve logs, witness receipts, policy history and backup. No database rollback, destructive cleanup or retry after unknown switch. Stop only within granted safe-stop scope; unconfirmed stop => STOP_UNCONFIRMED. No rollback of main by reset/force push: any source revert uses reviewed protected integration.

## Later stages
Reuse existing G3 preflight: historical writes remain UNKNOWN without replay; preserve reserved roots, require independently approved fresh disjoint IDs and read-only collision evidence before any synthetic write. G4: one admitted synthetic lifecycle; G5: UI/cross-account/no-send proof; G6: independent review and owner READY_FOR_DEMO. None opens before prior physical acceptance. No new tests or live writes performed solely to manufacture progress.

## Current handoff boundary
Source preparation does not install a witness or supply real memberships. Actual release artifact, backup/restore proof, protected policy, native witness provenance and human login evidence are still required. Do not sign an installation using placeholders. One next decision covers protected source integration of the exact reviewed consolidated HEAD; subsequent artifact-specific deployment must be bound to actual built bytes, not guessed hashes. No Engine recovery or App registration is needed for G2.

## Consolidated owner decision boundary
The existing release validator requires a standalone owner comment matching exactly
`ASI-OWNER-APPROVE:RELEASE-EXCEPTION:550:<final-40-character-head>`.
The executing agent must not post it on behalf of the owner. The historical #542/#544 comments remain valid for their source SHAs and must not be requested again.
This comment permits the G2 file-scope exception only. A separate explicit merge action can be included in the same owner handoff, conditional on final required checks and independent review passing, and bound to the same HEAD. It does not authorize deployment, policy installation, membership changes or physical acceptance.
Once merge is authorized and completed, record the actual resulting main SHA and artifact checksum before presenting the artifact-bound Beget deployment decision. Human login and the later G2-to-G3 transition require their stated verification and permissions; a speculative SHA or source approval cannot substitute for these.
