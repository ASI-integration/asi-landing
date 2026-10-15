# Task 28 — Independent cross-PR consolidation audit (2026-10-14)

**Verdict: SOURCE-COMPOSITE TEST PASS / REAL CUSTODIAN INTEGRATION BLOCK.** This is a read-only code/evidence audit. No PR merge, owner grant, production deployment, Hetzner project/server mutation, new secret, real guest send or SQL execution was performed.

## Task28 continuation — October 15, 2026 (supersedes original six-PR scope)

The October 14 audit below records the correct historical **six-PR** source result. On October 15, the user requested continuing Task28 after a real technical Linux service was developed and separately reviewed.

**Seventh pinned PR:**
- [#448 — executable technical Linux custodian](https://github.com/ASI-integration/asi-landing/pull/448), exact head `313d00dc92014fb10866cca3c8e7fec0c2269598`, 7 added files; actual nonroot Linux `init / serve / client` process, kernel-peer-credential checks, bounded Unix IPC, persistent journal/failure handling and deterministic executable Python release tar.
- Individual [Linux service acceptance run 38690604351](https://github.com/ASI-integration/asi-landing/actions/runs/38690604351) **27/27 focused cases PASS**, plus exact-head PR Validation PASS. Independent CodeRabbit final status SUCCESS; both identified issues (journal upper bound and sparse/oversize archive) fixed and resolved.
- A real executable technical service is now present in PR448 **but is not installed, independently owned, signed or authorized**. Its CLI merely records synthetic technical events, does not issue real operator receipts, cannot approve or send guest messages and does not connect to Booking Ops/CRM/production.

**New Task28 composite CI:** `.github/workflows/strigunov-task28-composite-linux.yml` pins PR heads #440–445 **and #448**, with `34` disjoint added paths (27+7), and runs four Node source suites, two earlier Python fixtures and two real executable-service/release suites on one disposable Linux runner. The expected test count is **176** (98 + 23 + 28 + 17 + 10). This additional seven-PR combined acceptance must pass before being called complete; individual green CI is not a substitute.

**Revised P0 no-go verdict:** owner-controlled custody, physical distinct-UID access separation, owner-signed immutable release, real one-use native Phase2 receipt, and operational Booking Ops/CRM/guest-communication end-to-end connectivity are NOT implemented or attested. Do **not** mistake a real technical process for production authorization or pilot readiness. No merge to `main`, no installation on existing Hetzner Default servers, no cloud provisioning or live guest sends.

## Immutable audit reference
- Protected `main`: `9bc8175aa772e92366c7a2363e26900a042fc3ce` (Task21 technical lost-COMMIT baseline).
- Tasks 19 and 21 already had actual isolated native PostgreSQL technical acceptance: [Task19, 30/30 Phase1](https://github.com/ASI-integration/asi-landing/actions/runs/38573727019), [Task21, 3/3 actual P13 wire fault](https://github.com/ASI-integration/asi-landing/actions/runs/38582427316). Neither grants real operator authority.
- All six later PRs #440–445 have exact-head PASS in both their focused GitHub Actions and the required PR Validation; CodeRabbit feedback resolved (Task27 review no actionable findings). Every PR remains **OPEN/UNMERGED**.

| Task | PR | Exact audited head | Paths | Source-only or physical synthetic proof |
| --- | --- | --- | ---: | --- |
| 22 | [#440](https://github.com/ASI-integration/asi-landing/pull/440) | `6752def66167f7940b0746cfc08447e02955a33e` | 4 | Future independent custodian and revocation plan, not installed |
| 23 | [#441](https://github.com/ASI-integration/asi-landing/pull/441) | `0a8c5003bb687729ea7a93c8f15a92a8138bbc4b` | 4 | Proposed isolated Hetzner project/owner separation, not provisioned |
| 24 | [#442](https://github.com/ASI-integration/asi-landing/pull/442) | `7b6282f3106a534afc536f266b488232ab687e30` | 5 | Preview-only fixed-command parser and replay model; untrusted JSON state |
| 25 | [#443](https://github.com/ASI-integration/asi-landing/pull/443) | `79fae4e4db8cd76bf0783bb33f6a579034d8a87d` | 6 | Real disposable POSIX fsync, crash-after-write, 2-process lock and test-only Unix socket |
| 26 | [#444](https://github.com/ASI-integration/asi-landing/pull/444) | `822faea19477801987695a5c47d99e666ac2886c` | 4 | Real disposable Linux SO_PEERCRED observation; not distinct-UID physical denial |
| 27 | [#445](https://github.com/ASI-integration/asi-landing/pull/445) | `2dbce088ad8f8298a5c349224e10b19741610a00` | 4 | Deterministic **non-executable** tar review; no owner-signed release or installed service |

## Actual Task28 combined inspection

Using a newly created and isolated checkout `C:\Users\Admin\asi-task28-audit-20261014` at the above exact main SHA, fetched each `refs/pull/<number>/head` via Git and overlaid **only the tracked changed paths**. The combined candidate had **27 uniquely named added files** and **zero overlapping file paths**. `git diff --cached --check` PASS. No original branch, active worktree or production server was touched; no merge or commit created. This checks textual merge feasibility but does not prove semantic integration.

Ran focused tests from all six candidate sources in the same combined tree, on Windows:
- Node.js 22–25: **92 PASS / 6 Linux-only SKIP / 0 FAIL** (98 total).
- Python 26: **3 PASS / 20 Linux-only SKIP / 0 FAIL** (23 total).
- Python 27: **25 PASS / 3 POSIX-only SKIP / 0 FAIL** (28 total).
- **Total available combined Windows cases: 120 PASS / 29 expected platform skips / 0 FAIL**, out of 149.
- **Composite Linux acceptance executed by the Task28 GitHub audit workflow and PASS:** [GitHub Actions run 38611862046](https://github.com/ASI-integration/asi-landing/actions/runs/38611862046), single unprivileged GitHub-hosted Ubuntu runner and exact six pinned heads. All **149/149 focused cases PASS, 0 skipped, 0 failed**: Node Tasks22–25 98/98; Python Task26 23/23; Python Task27 28/28. Combined checkout yielded exactly 27 disjoint paths and clean diff. This proves the test sources coexist, NOT a running unified custodian.
- No new network/service/host operations and no real PostgreSQL replay occurred in Task28.

## Integration findings, prioritized

**P0 — real protected custodian is not implemented.** None of the six PRs installs an independent owner-controlled service with source immutable to the agent, owner-held key custody, verified issuer identity, restricted authenticated IPC or operator authority. Task22 and Task23 are validators of untrusted *proposals*, not actual custody.

**P0 — no end-to-end wiring.** The Task24 preview model, Task25 synthetic fsync journal and socket, Task26 Python peer observer, and Task27 non-executable tar are separate, isolated test modules. No runtime imports or authoritative bridge chain them into a runnable custodian. A green unit/fixture test must not become a `canApprove` or `canSend` signal.

**P1 — interface and identity differences.** Task22/23 proposal operation vocabularies include issuance/provisioning concepts absent from Task24's six preview commands; Task25 has synthetic journal events; Task26 has only three `inspect-*` operations; Task27 contains *no executable*. Their schemas, language/runtime assumptions (Node and Python), run IDs, identity source, and pinned base SHAs must be intentionally translated and jointly tested before any integration. The hardcoded `9bc817...` baseline is not proof of a newly reviewed release SHA after future merges.

**P1 — independent persistence/access tests absent.** Task25 proved local fsync and race behavior, but same-UID/root file replacement and untrusted rollback are not prevented by hash chaining. Task26 observed kernel credentials for the fixture's own UID and denied deliberately wrong *expected* IDs, but did not run an unauthorized process under a genuinely distinct UID. No owner-installed persistent ledger/vault or per-command externally authorized real operator exists.

**P1 — physical native Phase2 remains NOT_RUN.** Task19 Phase1 and Task21 P13 wire PASS do not cover the real Phase2 owner-issued one-use receipt, installation, host revocation, retired bootstrap role, actual consent or guest send. Native Phase2 requires a separate disposable, independently controlled owner-approved target.

**P2 — release and deployment separation.** Task27 checks exact content of a synthetic non-executable placeholder tar, not a real signed executable, secure installer, service configuration or measured host manifest. Cloud resource creation/billing and any root/API/SSH/secret handling are not approved here.

## Decisions and controlled consolidation plan

1. **Keep production and live guest sends closed.** `CLOUD_CUSTODIAN_INSTALLED=NO`, `OWNER_AUTHORITY=BLOCK`, `PHASE2_NATIVE=NOT_RUN`, `canSend=false`, `PILOT=NOT_LIVE`. Hetzner project `Default` contains the existing ASI runtime and landing servers; do not repurpose them as test hosts. `ASI-Lab` was empty in the user's screenshot.
2. Existing PRs #440–445 are **individually source/fixture CI green and file-disjoint**; they are **not** a complete custodian. They may be proposed for ordered code-only consolidation, but only after a separate exact owner grant for merge per `docs/agent-os/AUTONOMY_POLICY.md`. No permission is implied from this audit, from GitHub checkmarks, or from the user's request to audit.
3. **Composite Linux source acceptance now PASS** at run 38611862046. Before *any* merge proposal, agree on the real module/interface integration gap, review the final source SHA after any consolidation and run tests again on that reviewed head. Avoid automatically merging six unrelated source candidates into a live release.
4. Next engineering deliverable is a single restricted, review-pinned service architecture that integrates Linux peer credentials, bounded IPC, owner-protected durable one-use ledger and held authority, with separate failure/rollback proofs. Do not connect an agent-controlled artifact to operator credentials.
5. **Gate29, separately:** on an independently controlled, owner-approved and cost-approved isolated cloud host, test real separate UID/GID unauthorized clients, protected binary/config/vault and durable restart, one-use Phase2 synthetic PostgreSQL receipt, revocation, and cleanup. Only then consider separately gated real pilot consent/send readiness.

## Final Task28 outcome

**Audit result:** 6 PRs / 27 disjoint paths / 120 Windows-applicable tests passed plus **149/149 Linux composite source tests PASS** / all six exact-head individual GitHub CI success. **Composite runnable custodian = BLOCK**. Task27 is not the finishing line; additional integration and physical acceptance work is materially required. **No merges, production modifications or live messages.**
