# Strigunov restricted pilot — protected custodian / Booking Ops go-no-go (2026-10-15)

**Engineering decision:** first prove the actual public intake → CRM operator-visible queue route in isolation, with a *physical local fsync surrogate for the Supabase repository*. Then separately prove native PostgreSQL/staging/host custody. **Do not call mocked external integrations a live full-cycle acceptance.**

## Exact intended pilot scope

Invitation: a controlled free 14-day **guest-communications** pilot. Do not promise 99% platform-wide autopilot, automatic OTA distribution, OkiDoki legal signatures, guest deposits, МВД flows, payments or external cleaning dispatch. Operator/manual fallback is part of the initial scope.

Historical evidence:
- Task19 native synthetic Phase1 and Task21 P13 lost-COMMIT race PASS, **not** owner-issued real Phase2.
- Task22–27 source candidates in PRs #440–445; Task28 [audit PR #447](https://github.com/ASI-integration/asi-landing/pull/447) has confirmed **176/176** combined Linux focused tests with runnable nonauthorizing technical custodian PR #448.
- [Executable custodian PR #448](https://github.com/ASI-integration/asi-landing/pull/448) Linux actual process and unsigned archive tested, CodeRabbit status success. **No separately installed owner-authorized service**.
- Existing `scripts/strigunov-pilot-acceptance.mjs` is **SP-09 mock**; `scripts/booking-ops-v13-full-lifecycle-acceptance.mjs` requires real staging Supabase/environment settings and explicitly forbids real sends; **not executed here**. The new single-file focused test is a different scoped proof.

## Current milestone: physical synthetic intake/queue continuity

`src/app/api/early-access/leads/__tests__/strigunov-synthetic-e2e.test.ts` calls the **real** `POST /api/early-access/leads` and **real** authenticated `GET /api/dashboard/crm/queue` functions, normalization, process-local anti-abuse, real access guard, and real CRM queue grouping/attention logic. It substitutes ONLY the CRM database connector with a **fresh OS temporary file** containing synthetic contact rows; inserts are `fsync`ed before success, and every operator read physically reopens the file. External booking signals and event feeds return empty synthetic stubs; no provider message dispatch is imported or invoked. Credentials, cloud, paid service, production URLs and real guest PII are absent.

The scenario suite checks consent/honeypot/bad contacts; real visitor response strips contact and internal CRM ID; local persistence before 201; operator access denial without a session or configured secret; operator attention queue visibility of the **same** row; duplicates/concurrency, failure and bounded retry; spoofed header contact quota; archive and manual follow-up queue transitions; corrupt-read failclosed and no outbound communication.

**Proof limit:** this is a route-and-persistence-adapter contract test. It is not a native `crm_contacts` PostgreSQL write, not a Supabase production/staging readback, not a verified operator receiving a real lead, not a real OS-host identity, and not a true guest Booking Ops lifecycle. The process-local limiter resets on restart; do **not** treat it as cross-instance abuse control.

## Go/no-go matrix for the actual Strigunov limited end-to-end

| Gate | Required evidence | Status after current task |
| --- | --- | --- |
| A | Public owner form validates referral, consent, honeypot and contact | Source + focused synthetic API tests |
| B | Duplicate and rate protection across restarts/multiple instances | **BLOCK** — process-local only, need edge/distributed acceptance |
| C | Real isolated PostgreSQL `crm_contacts` durable insert and authenticated operator readback | **NOT_RUN** — fsync adapter test is not database integration |
| D | Owner object ready; safe channel-manager relationship; booking/import and guest intake | **NOT_RUN** as one joined flow |
| E | Legal/readiness gates and messaging draft correctly created | **NOT_RUN** as one joined flow |
| F | Authorized operator sees exception and can manually triage/reply | API queue contract source test; physical operator access **NOT_RUN** |
| G | No premature Telegram/email sends; approved outbound consent and exact provider proof | **BLOCK** for actual sends; synthetic-only dry-run permitted |
| H | Durable booking closeout, CRM status update and no duplicate guest communication | **NOT_RUN** as one integrated real store lifecycle |
| I | Native custodian owner-issued receipt, true separate UID/GID denial, signed binary and durable owner ledger | **BLOCK** — custodian technical-only executable |
| J | 20–30 pilot scenarios on separately verified nonproduction host, audit and cleanup | **NOT_RUN** |
| K | Approved production rollout/guest consent/public Strigunov invite | **BLOCK** (explicit owner action) |

## Explicit nonproduction owner-controlled host preflight

Only on a **separate owner-approved Hetzner Cloud project/server** with exact project ID/server ID, owner-confirmed cost cap, non-agent-held credentials and Tailscale/ACL/network isolation may an authorized operator install a reviewed custodian. The two existing `Default` production servers (`asi-runtime-hetzner` and `asi-landing-hetzner`) are excluded. Do not install `asi-custodian-technical-v0.tar` as an authorized real operator; the archive is unsigned, only technical, no guest send/Phase2 authority.

Physical checks required prior to any privileged action: independently pinned release digest and ownership; `service UID != agent/client UID`; true distinct-UID bad-client denial; protected socket/state/vault ownership; durable one-use ledger through actual restart and split-brain/replay; no uncontrolled root/cloud tokens; synthetic native Phase2 with owner-held one-use receipt, revocation and RLS proof; rollback and zero synthetic leftovers. No bypass by program-generated `authorized=true` or by a connected VPN.

## Next steps (do not collapse gates)

1. Focused single-file API/CRM queue test + project CI + independent CodeRabbit review. If this test fails, fix and rerun. Never present this as native DB proof.
2. Build **real isolated Postgres receipt/readback** and test authorized CRM queue without synthetic adapter on a uniquely scoped staging-only database. Prepare exact rollback and no external message flags.
3. Bind the operator inbox → Booking Ops reservation/intake → draft → manual exception → closeout across a single synthetic booking with strong per-tenant isolation.
4. Separately authorize/install the owner-custodied custodian and perform true native Phase2.
5. Run the agreed 20–30 failure/success cases, audit privacy, versions and operator fallback, then request explicit owner consent for any live pilot or Strigunov public invitation.

**No production deploy, real messages, payment, cloud provisioning, main merge or real-data operations are part of this task.** Per `docs/agent-os/AUTONOMY_POLICY.md`, all such actions require a separately scoped owner approval. `PILOT=NOT_LIVE`, `REAL_GUEST_SEND=BLOCK`, `NATIVE_PHASE2=NOT_RUN`.
