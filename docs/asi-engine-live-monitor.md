# ASI Engine LIVE — GuestAutopilot owner monitor

Route: `/dashboard/engine-live` (visible in the dashboard sidebar only to the development owner).

## What it monitors

- The five independent V14 Strigunov G2 recovered Codex tasks
- Current recovered task states, new Grok-review reservations and GitHub effect reservations
- Draft PRs and GitHub checks read for their **exact current HEAD**
- Freshness of the most recent source report, with stale/unavailable warnings

The website polls its existing authenticated `/api/dashboard/engine-progress` every 15 seconds. The active source is the private `ASI-integration/asi-os-runtime` recovery issue #199, which reports review outcomes, Draft PR receipts and the separate five-review quota; the exhausted original V14 issue #188 is historical only. **This is near-live monitoring, not a direct high-frequency VPS heartbeat**.

A task marked `RUNNING` does not prove a model call succeeded. Reserved calls are not confirmed charges. `CI_PASS` requires independently read GitHub evidence. No button can invoke models or change production state.

## One-time Vercel configuration

These values must be set in the **production environment** of the Vercel project `asi-landing-new` (the project attached to `guestautopilot.com`):

1. `ASI_DEVELOPMENT_OWNER_EMAILS`: the exact email of the account authorized to use the existing development console. No implicit CRM-operator-to-owner elevation.
2. `ASI_ENGINE_GITHUB_READ_TOKEN`: a **read-only** GitHub credential stored as an encrypted environment variable. Give it access to only:
   - `ASI-integration/asi-os-runtime`: Issues / metadata read, for issue #199
   - `ASI-integration/asi-landing`: Pull requests, Contents/metadata and Checks read, for exact-head CI receipts

The existing `GITHUB_TOKEN` variable also works if a properly scoped token is already configured. Do not paste tokens into a chat, client component, URL, Git commit or public environment variable. The token is read strictly on the server after `requireDevelopmentOwnerSession()`.

After changing Vercel environment variables, redeploy the tested commit to apply them.

## Failure behavior

- No token, invalid owner session or forbidden GitHub access: no private status exposed, unavailable warning only
- No recent valid report: explicitly stale, never green
- Missing checks, wrong head or GitHub request failure: CI unknown, never accepted
- The V14 journal and VPS worker processes are not modified by this dashboard

## Verification

- `npx vitest run src/lib/engine-progress/__tests__/live-contract.test.ts`
- `npm run typecheck`
- Verify authenticated owner route and denied request without owner session
- Confirm last report timestamp, five tasks, PR links and exact-head checks
- Confirm no token appears in browser JavaScript or Network responses

## Data provenance

- Protected source issue: `https://github.com/ASI-integration/asi-os-runtime/issues/199`
- V14 recovery tasks and status reporting: `ASI-integration/asi-os-runtime/ops/v14`
- Historical V12, V13 and exhausted original V14 results are not silently mixed into the recovered campaign.
