---
name: asi-website-editor
description: Review ASI-integration/asi-landing public RU site copy as a first-time visitor, ground findings in approved product/pricing contracts, and (only with an explicit owner-approved public-copy gate) apply the smallest source edit, verify it with the deterministic Website Auditor, and open a draft PR. Use for RU acquisition-page editorial clarity work; never merges or deploys.
---

# ASI website editor

Default to read-only editorial `review`. Public RU copy is a red action under Agent OS: this Skill only edits source in `apply` mode when a matching owner-approved `approved_ux_or_public_copy_change` gate exists, and it never merges or deploys.

## Allowed actions

- Read a public RU route as a first-time visitor before reading its implementation source.
- Ground editorial findings in `docs/agent-os/PRODUCT_CONTRACT.md`, `scripts/site-audit/contracts/ru-public-site.mjs`, and current RU source constants.
- Produce a structured finding/edit-plan set without dictating exact replacement sentences.
- Run `scripts/preflight.mjs` to resolve route/source mapping and owner-gate status.
- In authorized `apply` only: make the minimal allowlisted source edit, run the deterministic site auditor, focused tests, lint, and typecheck, then commit, push a task branch, and open a **draft** PR.

## Forbidden actions

- Merge, production deploy, or any workflow dispatch.
- Redesigning visual/typography/spacing systems; editing anything outside copy, microcopy, CTA wording, examples, in-section ordering, or metadata title/description.
- Inventing capabilities, integrations, metrics, prices, or legal promises not already approved.
- Editing LEGAL, AUTH, payment, database, or Runtime-behavior source files.
- Applying a source edit without a valid owner gate whose `action` is exactly `approved_ux_or_public_copy_change` and whose `target`/scope match the exact route being edited.
- Treating typed confirmation as owner approval.

## Workflow

1. **Public-site-first review** — inspect the rendered **live production** route (`references/ru-public-site-map.md`'s production host) before reading its implementation source, so the assessment reflects a visitor with no internal ASI context. This live production read is the **pre-edit visitor baseline only**; it is never reused later as evidence about edited source. For the route, assess whether a first-time visitor can quickly answer: what the product/service is; who it is for; what concrete job it performs; what happens automatically; when a human becomes involved; what the main next action is; and, if pricing/pilot terms are shown, whether they are understandable without reading the whole page. Note vague slogans, assumed prior knowledge, internal/technical vocabulary, unclear claim subjects, duplicated ideas, buried facts, headline/subheadline mismatch, contradictory pricing/pilot wording, CTA-explanation mismatch, and architecture-ordered (rather than comprehension-ordered) sections. This is editorial judgment, not a regex rule — do not try to encode it as a deterministic pattern in `scripts/site-audit`.
2. **Grounding** — only after step 1, read `docs/agent-os/PRODUCT_CONTRACT.md`, `scripts/site-audit/contracts/ru-public-site.mjs` (`RU_PUBLIC_SITE_CONTRACT`), and the relevant current RU source/constants. Never invent capabilities, integrations, guarantees, metrics, prices, or legal promises; where visitor clarity conflicts with unsupported marketing ambition, factual product truth wins.
3. **Edit plan** — produce findings with route/surface, observed visitor problem, why it is confusing, source path, proposed editorial intent, factual grounding, and risk classification. Do not require the owner to dictate exact replacement sentences.
4. **Owner gate** — from the repository root, run `scripts/preflight.mjs --market ru --mode <review|apply> --route <route> [--gate <path> --expected <path>]`. In `apply` mode without a gate whose `action` is `approved_ux_or_public_copy_change` and whose target/scope matches the exact route, stop and return `AWAITING_OWNER` with the proposed scope. Once that scope is authorized, choose the exact wording independently — do not stop to ask the owner to rewrite individual sentences. Authorization to edit never authorizes merge or deploy.
5. **Source edit** (authorized `apply` only) — make the smallest coherent change; preserve the approved visual design, functional behavior, legal/compliance requirements, and approved pricing/pilot mechanics; do not opportunistically rewrite unrelated pages or sections.
6. **Verify** — post-edit deterministic verification must target the **edited task branch**, never unchanged production: start the app locally from the current branch (`npm run dev -- --hostname 127.0.0.1 --port <references/ru-public-site-map.md's local verification port>`), run the deterministic site auditor (`npm run site:audit -- --base-url http://127.0.0.1:<port>`) in its safest read-only mode against that local branch-rendered route, then stop the local server. A live-production auditor run may still be captured for comparison, but must be labeled "production baseline/reference" and must never be reported as evidence that the branch's edit passed post-edit verification — unchanged production can never substitute for a branch-rendered check. If the branch-rendered target cannot be started or audited safely, do not fall back to production silently: report the site-audit check as `SKIP`/`BLOCKED` per `references/result-contract.md` and continue only with the other valid focused checks (tests, lint, typecheck, `git diff --check`) — never claim the branch passed the deterministic auditor. A deterministic audit pass is a verification dependency of this Skill, not proof of editorial quality on its own — this Skill does not duplicate the auditor's rules.
7. **Publish** — for an authorized source edit, exact-path stage, commit, push the task branch, and open a draft PR. Report branch, commit SHA, PR URL, exact changed files, and check results. Never merge. Never deploy.

## Mandatory stop conditions

- `apply` requested without a valid owner gate matching the exact action/route/scope.
- Route or source mapping cannot be resolved in `references/ru-public-site-map.md`.
- Market is not yet supported.
- The proposed edit would touch a file outside the allowlisted route source, or falls into payment, authentication, database, or Runtime-behavior logic.
- The proposed wording would introduce an unsupported claim or contradict `docs/agent-os/PRODUCT_CONTRACT.md` / `RU_PUBLIC_SITE_CONTRACT`.
- The deterministic site auditor or focused tests regress after an edit.
- Reporting an unchanged live-production auditor run as post-edit verification of branch/source changes; production may only ever be labeled a pre-edit baseline or reference.

## Resources

- `scripts/preflight.mjs` — read-only market/mode/route/owner-gate resolution.
- `references/editorial-contract.md` — first-time-visitor editorial criteria and claim-safety grounding.
- `references/ru-public-site-map.md` — RU route-to-source mapping and auditor entrypoint.
- `references/result-contract.md` — required review/apply result fields.
