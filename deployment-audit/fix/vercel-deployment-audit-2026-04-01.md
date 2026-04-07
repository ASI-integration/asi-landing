# Vercel Deployment Audit - 2026-04-01

Project: asi-landing-new
Workspace audited: C:\projects\asi-landing

## 1) Deployment/build configuration audit

- Framework: Next.js (App Router)
- Build script: `npm run build` -> `next build` (package.json)
- Start script: `next start`
- Vercel project mapping: `.vercel/project.json`
  - projectName: asi-landing-new
  - rootDirectory: null (defaults to repository root `.`)
  - outputDirectory: null (Vercel default for Next.js)
  - buildCommand: null (Vercel default resolves to `npm run build`)
  - installCommand: null (Vercel default)
  - nodeVersion: `24.x`
- No `vercel.json` is present, so Vercel defaults are active.

Conclusion: root/output/build assumptions are correct for this repo. No misconfiguration found in project-level build settings.

## 2) Recent deployment status inspection

Source: `vercel list`, `vercel inspect`, and `vercel inspect --logs`

- Production (current):
  - dpl_54izXHCTrNvQiRMZjToadA6QqDMv
  - URL: https://asi-landing-89nqay39r-asi-integrations-projects.vercel.app
  - Status: Ready

- Latest successful preview:
  - dpl_3Xm3zqLv8kkNhKHG67mSQbAvKfAW
  - URL: https://asi-landing-e4wukght3-asi-integrations-projects.vercel.app
  - Status: Ready

- Latest failing preview:
  - dpl_C7Jc1KD94UqepgXGuChjysDo9Gdt
  - URL: https://asi-landing-m8sxh6zi3-asi-integrations-projects.vercel.app
  - Status: Error

Additional older failed previews:
- dpl_4PwrLYiguEtPKnhs8qqXfLAdB8kR
- dpl_BiVMVYsWuh19jpUVRVsZ6Hr6DATA

## 3) Failure clustering

### A) Current real blocker (latest failing preview)

Deployment: dpl_C7Jc1KD94UqepgXGuChjysDo9Gdt

Build log root cause:
- `./src/lib/communication/session-status.ts:149:19`
- Type error: `Argument of type 'string' is not assignable to parameter of type 'BackgroundContext'.`
- Failing line in that deployment build log:
  - `runInBackground('transitionSessionStatus_db', async () => { ... })`

Interpretation:
- `runInBackground` API expects a structured context object as first argument.
- That deployment used an outdated call signature (string instead of object), causing TypeScript compile failure.

### B) Stale/irrelevant failed previews

Deployments:
- dpl_4PwrLYiguEtPKnhs8qqXfLAdB8kR
- dpl_BiVMVYsWuh19jpUVRVsZ6Hr6DATA

Build log root cause:
- `./src/lib/location/config.ts:7:3`
- Type error: MagnetCategory entries missing required fields `scopeLevel` and `strengthClass`.

Why stale:
- These failures are older and followed by multiple successful previews and a successful production deployment.
- They do not represent the current deployment state.

## 4) Fix status

No source edits were applied in this audit pass.

Reason:
- The latest successful preview (dpl_3Xm3zqLv8kkNhKHG67mSQbAvKfAW) already compiles and deploys after the latest failed preview.
- Current workspace code in `src/lib/communication/session-status.ts` already uses the correct object-based `runInBackground(...)` signature.
- Therefore, the real blocker is already resolved in newer deployment content.

## 5) Deployment health summary

- Current production status: Healthy (Ready)
- Latest successful preview: https://asi-landing-e4wukght3-asi-integrations-projects.vercel.app
- Latest failing preview: https://asi-landing-m8sxh6zi3-asi-integrations-projects.vercel.app
- Exact root causes:
  - Current/latest failed preview: wrong `runInBackground` call signature in `session-status.ts` (string passed instead of `BackgroundContext` object).
  - Older stale failures: `MagnetCategory` type mismatch in `src/lib/location/config.ts`.
- What was fixed in this pass:
  - Audit-only pass; no new code fix needed because blocker already resolved in latest ready preview.

## 6) New preview creation

No new preview was created during this audit.
Recommended currently healthy preview URL:
- https://asi-landing-e4wukght3-asi-integrations-projects.vercel.app
