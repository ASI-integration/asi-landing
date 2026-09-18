# Editorial contract

This Skill judges public RU copy the way a first-time visitor would experience it, not the way an internal reader familiar with ASI's architecture would. It never substitutes deterministic exact-string rules for that judgment.

## First-time comprehension

- Optimize for a stranger with no knowledge of ASI, no knowledge of Runtime architecture, no knowledge of STR terminology, and no memory of a previous version of the site.
- Concrete explanation comes before abstract benefit. Name the product noun, the action it performs, and the audience it serves before describing why that matters.
- Prefer progressive disclosure: the first screen should let a visitor answer what the product is, who it is for, what job it performs, what happens automatically, when a human becomes involved, and what to do next — before deeper detail.
- Use simple, natural Russian. Avoid internal/abstract vocabulary (e.g. layer/contour/orchestration/workflow/runtime/automation-engine style language) on customer-facing acquisition pages unless the page is explicitly technical.
- Do not replace one vague phrase with another. Marketing words (efficient, innovative, scalable, intelligent, next-level, revolutionary, unique platform, business transformation, and similar) are only acceptable when the sentence also answers "how?" with something concrete.

## Grounding, not invention

- Every factual claim must be traceable to `docs/agent-os/PRODUCT_CONTRACT.md` and to `RU_PUBLIC_SITE_CONTRACT` in `scripts/site-audit/contracts/ru-public-site.mjs` (setup/pilot/continuation pricing and mechanics, and current product-position facts).
- Never invent capabilities, integrations, guarantees, metrics, prices, or legal promises. If it is unclear whether a capability exists, do not claim it.
- Treat `scripts/site-audit/rule-engine.mjs`'s `UNSUPPORTED_CLAIM_PATTERNS` and `OBSOLETE_JARGON_PATTERNS` (in the same contract file) as a floor, not a ceiling — a claim can be editorially unsupported even when it does not match an existing regex.
- Where visitor clarity would conflict with an unsupported marketing ambition, factual product truth wins; narrow the claim instead of removing the clarity problem.

## Scope discipline

- Distinguish "the wording is unclear" from "the product does not have this capability." The first is this Skill's job to fix; the second is a product decision, not a copy edit, and must be escalated rather than papered over with vaguer language.
- Do not change visual design, typography, spacing, or the approved component system merely because the copy near it is weak. A structural JSX change is only acceptable when it is minimal and strictly required to fix a semantic problem (e.g. removing a duplicated block), never a redesign.
- Do not optimize for SEO keyword density at the expense of first-time comprehension.
- Findings and edit plans describe the visitor problem and the editorial intent; they do not require the owner to dictate the exact replacement sentence.
