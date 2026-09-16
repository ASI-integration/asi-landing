# ASI Agent OS — GitHub protection for AO-001 / AO-002

This document is the owner runbook for closing **AO-001** (main protection) and **AO-002** (environment reviewer gates). Workflow YAML never closes these blockers.

Machine contract: [`github-protection-desired.json`](./github-protection-desired.json).  
Auditor: `node scripts/agent-os/check-github-protection.mjs`.

## Live audit snapshot (2026-09-16)

Captured with GitHub API against `ASI-integration/asi-landing` (owner type: User `ASI-integration`).

| Surface | Live state |
| --- | --- |
| Classic branch protection on `main` | **Absent** (`HTTP 404 Branch not protected`) |
| Rulesets | One ruleset `MyRule` (**enforcement: disabled**), empty include refs, only `deletion` + `non_fast_forward` |
| Environment `staging` | Exists; **no** required reviewers; **no** deployment branch policy; `can_admins_bypass=true` |
| Environment `production` / `Production` | Exists; required reviewer `ASI-integration`; custom branch policy **main only**; `can_admins_bypass=false` |
| Environment `production-migration-approval` | Exists; required reviewer `ASI-integration`; custom branch policy **main only**; `can_admins_bypass=true` |
| Required PR check name in Actions | job name **`validate`** (workflow `PR Validation`) |

## Classification

### A) Already satisfied
- `production` environment: required reviewer `ASI-integration`, deployment branch `main`, admin bypass disabled.
- `production-migration-approval`: required reviewer + `main` branch policy present (admin bypass still enabled — not fully closed).
- PR Validation already emits a stable required-check candidate: `validate`.

### B) Repository changes in this PR
- Desired-state JSON + schema.
- Offline/live auditor with fixtures/tests.
- `.github/CODEOWNERS` so “require code owner reviews” has a real owner (`@ASI-integration`).
- This runbook with exact UI values.
- CI offline enforcement of the contract (does **not** mutate GitHub Settings).

### C) Owner/admin GitHub Settings only (minimal)

Do these in order. Do not deploy and do not change secrets.

#### C1 — Close AO-001: protect `main`

1. Open https://github.com/ASI-integration/asi-landing/settings/rules  
2. Delete or ignore disabled `MyRule` (optional cleanup).  
3. Click **New ruleset** → **New branch ruleset**.  
4. Exact values:
   - **Ruleset Name:** `protect-main`
   - **Enforcement status:** `Active`
   - **Bypass list:** empty (do not add yourself)
   - **Target branches** → Include → `refs/heads/main` (or default branch)
5. Enable rules:
   - **Restrict deletions**
   - **Block force pushes**
   - **Require a pull request before merging**
     - Required approvals: `1`
     - Dismiss stale pull request approvals when new commits are pushed: **ON**
     - Require review from Code Owners: **ON**
   - **Require status checks to pass**
     - Do not allow bypassing: **ON** if shown
     - Add required check exactly: `validate`
6. Save.  
7. Confirm classic protection is not needed if the ruleset is active and covers the same controls. Prefer **one** enforced mechanism (ruleset).

Alternative (classic UI):  
https://github.com/ASI-integration/asi-landing/settings/branches → Add classic branch protection rule for `main` with the same PR/review/check/force-push values and **Do not allow bypassing the above settings** / include administrators.

#### C2 — Close AO-002: staging + tighten migration approval

1. Open https://github.com/ASI-integration/asi-landing/settings/environments  
2. Click **staging**:
   - Required reviewers: add `ASI-integration`
   - Allow administrators to bypass configured protection rules: **OFF**
   - Deployment branches: **Selected branches** → add `main` only
   - Save protection rules
3. Click **production-migration-approval**:
   - Keep required reviewer `ASI-integration`
   - Keep deployment branch `main`
   - Allow administrators to bypass: **OFF**
   - Save
4. Click **Production** / `production`:
   - Confirm required reviewer `ASI-integration` still present
   - Confirm deployment branch `main` still present
   - Confirm administrators bypass is **OFF**
   - Save if anything changed

#### C3 — Verification (required for honest closure)

1. Run live auditor:

```bash
node scripts/agent-os/check-github-protection.mjs --mode live
```

Expect `"ok": true` and empty `gaps`.

2. AO-001 test PR: open a docs-only PR into `main`. Confirm:
   - direct push to `main` is rejected;
   - merge is blocked until `validate` is green;
   - merge is blocked until 1 approving review / Code Owners review.
3. AO-002 verification without mutation:
   - Dispatch a **read-only** staging workflow that uses `environment: staging` (for example inspect/probe workflows) and confirm it waits for environment approval.
   - Do **not** run deploy or migration apply for this verification if avoidable.

## Closure rule

Leave AO-001 / AO-002 **open** in `BLOCKERS.md` until:

1. live auditor exits 0; and  
2. the test PR / environment wait evidence above exists.

Then mark closed with links to the ruleset URL, environment settings screenshots or API dumps, and the verification PR/run URLs.
