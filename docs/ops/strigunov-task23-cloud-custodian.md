# Task 23 — independent cloud custodian: Hetzner design and automated source gates

**Status:** SOURCE-ONLY CANDIDATE, **NO CLOUD SERVICE/PROJECT CREATED**. No account charges, cloud API access, Tailscale or production changes. Do not interpret the source checker output as an installed custodian.

## Why cloud instead of Windows
The user selected the cloud route. The old Task15 Windows plan at `C:\Users\Admin\asi-strigunov-2x\STRIGUNOV-CUSTODIAN-PREP-20261014\04-TASK15-OWNER-MANUAL-PROCEDURE.md` is a **deferred reference document**, not an immediate action. There is no safe ready-to-run Windows installer. **Never launch** `01-OWNER-SETUP.ps1`. The source-only static review can be automated later, but no self-assessment may masquerade as independent OS security proof.

## Concrete planned cloud architecture
Choose **a new, empty Hetzner Cloud project** dedicated to `ASI Strigunov Custodian Lab`, separate from the existing ASI runtime and production project. Do not move, reboot, reconfigure or reuse the existing servers. Do not create any new paid server until explicit owner approval of expected charges, instance, region, duration and disposal plan.

Hetzner official documentation:
- [Cloud projects and roles](https://docs.hetzner.com/cloud/general/faq/): each project has member roles; an Owner manages billing and resources. Project roles by themselves do **not** prevent the same owner account from controlling both projects.
- [Project-scoped API credentials](https://docs.hetzner.com/cloud/api/getting-started/using-api/): a token is bound to one project, not globally valid for others. Never send tokens into chat, GitHub PRs, files or the agent machine.
- [Firewall/network API](https://docs.hetzner.cloud/reference/cloud): no ingress rules implies default inbound DROP; egress defaults ACCEPT unless explicitly restricted. No assumption that adding a private Network magically disables public internet.
- Existing Tailscale access may be used as a transport, but Tailscale connectivity is **not** an authorization or independent issuer. The owner must control and independently test device identity, ACLs, keys and revocation.

### Separate trust domains
1. **Owner plane** (outside agent): only the human controls the Hetzner project, creation, billing, root/recovery console, firewall/network, protected executable and key store; the agent receives no Hetzner API token, cloud project Admin role, root SSH or ability to overwrite release files. If the owner shares the same provider superuser for production and lab, this is operator separation from the agent, **not** protection from the owner.
2. **Execution plane**: future owner-created single isolated disposable server; small non-root service, pinned executable/image hash and non-agent-writable configuration, private state and credential store, replay-resistant durable consumed-ID ledger. No arbitrary shell, SQL, executable, file path or callback over RPC.
3. **Communication plane**: deny public inbound (both IPv4/IPv6), isolated VPC/networks from production, Tailscale device/ACL solely owner-managed, broker reachable only via explicitly authenticated restricted channel; restrictive outbound rules must be verified (provider default outbound ALLOW). No production guest, database, Telegram/email/voice or payment endpoints.
4. **Evidence plane**: owner separately observes project/server IDs, immutable binary/config hashes, service UID/PID/start time, cloud metadata, effective ACLs, live network rules and denial to an unauthorized principal. Agent-submitted JSON and GitHub Actions logs are not authoritative identities. Fresh narrow owner approval required before any host mutation.

### Gate for Phase 2
Reuse independently verified Task19 native Phase1 [run 38573727019](https://github.com/ASI-integration/asi-landing/actions/runs/38573727019) and Task21 lost-COMMIT [run 38582427316](https://github.com/ASI-integration/asi-landing/actions/runs/38582427316). Those synthetic PostgreSQL PASS results **do not** prove a real tenant operator. Before a new synthetic Phase2 approval:
- Independently retire privileged setup role, members and active bootstrap sessions; verify database/role OIDs, system ID and exact source/image before consuming one fresh owner-custodied limited one-use receipt.
- Test tenant/actor isolation, stale epochs, revoked access, missing policy/consent, double-consume, unknown COMMIT and restart/replay against a **fresh isolated PostgreSQL instance**. A synthetic consent fixture is never real guest consent.
- Keep `phase2=BLOCK`, `canApprove=false`, `canSend=false` and pilot `NOT_LIVE` until independent live provenance and guest consent gates are separately verified.

## What Task 23 actually implements
- `scripts/acceptance/strigunov-task23-cloud-custodian.mjs`: pure offline candidate shape inspection checking project isolation, token/agent separation, inbound/egress controls, owner-managed Tailscale, pinned broker, one-use ledger, historical native evidence and explicit denial of production/guest scope.
- `scripts/__tests__/strigunov-task23-cloud-custodian.test.mjs`: negative-case suite for shared production, tokens, privileged access, replay, and forged permission flags; a seemingly perfect proposal is *still* `PLAN_SHAPE_ONLY`, never authority.
- `.github/workflows/strigunov-task23-cloud-custodian.yml`: ordinary PR-only `contents: read`, no secrets or cloud network calls, no dispatch or live PostgreSQL.

## Next owner action (not required to complete source-only Task23)
Once architecture and branch are reviewed, the **first cloud-console action** is to create an **empty** separate project in the user's existing Hetzner account, named `ASI Strigunov Custodian Lab`. Do not create or rent a server yet, and do not generate or share an API token. Creating an empty project does not verify host isolation; it only reserves a scope. If the project already exists, do not create a duplicate: inspect access and exact ID first.

**The agent can then independently prepare deploy manifests, source/CI and test cases.** Actual paid VM creation, root owner installation, token handling, and real operator authority remain owner-controlled red actions; a future automation cannot authorize itself.

## Branch and prior Task22
Task22 PR [#440](https://github.com/ASI-integration/asi-landing/pull/440) remains unmerged and does not block preparing this cloud-specific code. Task23 bases strictly on protected `main` at `9bc8175aa772e92366c7a2363e26900a042fc3ce`, introduces only four new source/testing/doc/CI files and does not rename branches or modify the existing local worktrees.

Existing Agent OS autonomy policy defines `main` merge and cloud creation as red. This PR must not be merged without explicit owner approval identifying PR number and reviewed head SHA. The actual service remains `NOT_INSTALLED`.
