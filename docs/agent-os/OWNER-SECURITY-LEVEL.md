# ASI owner-set security level — NORMAL (freeze until owner changes it)

**Owner instruction — 30 October 2026.** This is the agreed default for the existing Engine on Beget. It is not a new root privilege, signature, or permission to install.

**Normal means:** one real, authenticated owner decision for the exact privileged release, not a mandatory second human reviewer. For the first bounded acceptance, allow the existing `OWNER_VERIFIED_CI` path for exactly **two** G2 witness jobs, using genuine external CI verification and the owner’s real signature. Do not demand a new owner approval for every preparatory commit or each in-scope child task. The preferred future delegation is **one owner-signed revocable parent up to 365 days** with short children up to 14 days **only after a working native verifier and revocation/budget protection exist**.

**Keep:** signed privileged installation, exact scope, real provider-origin evidence where required for old-writer shutdown, reasonable sandboxing, state and replay protection, zero unauthorized production writes, bounded budgets, and rollback. These are engineering safeguards, not a pretext for a second reviewer or an open-ended escalation of ceremony.

## No unilateral increases

The frozen machine-readable policy is `docs/agent-os/owner-security-baseline.json`. Tests verify its exact normal-level contract. A proposed change to the policy or its verifier must receive **one** authenticated owner approval for the **exact PR and HEAD**:

`ASI-OWNER-APPROVE:SECURITY-BASELINE-CHANGE:<PR>:<HEAD_SHA>`

An AI comment, GitHub App, workflow, automatic agent, or unsigned draft cannot issue it. Do not silently add mandatory human reviewers, micro-approvals, shorter blanket permission periods, extra owner prompts, or new launch gates. If a real threat warrants a new restriction, propose the exact change to the owner; until then retain this level. An emergency may **stop** unsafe operations but must not silently rewrite the standing policy.

All future implementation must respect this owner decision. Existing protected `main` and Beget remain unchanged until reviewed and adopted; the contract is **not active** merely because a proposal exists.

## Proof and scope

`scripts/agent-os/verify-owner-security-baseline.mjs` validates the checked-in JSON against the pinned normal baseline. Its tests deliberately attempt silent increases and fail. `check-demo-release.mjs` registers the policy, verifier and tests as protected governance files and requires the one owner exact-head security-baseline approval for their changes. The CI test checks these invariants.

**Limit of proof:** tests can prove the rules currently checked; they cannot physically prevent an administrator from changing GitHub branch protection, root-owned server files, or all future code simultaneously. Real long-term enforcement additionally requires merging this policy into protected `main` under owner approval, maintaining protected branch settings, and applying it in the installed Engine. The proof is therefore reported separately as `SOURCE`, `PROTECTED_MAIN`, and `LIVE_SERVER` status — never claimed from a Draft PR alone.
