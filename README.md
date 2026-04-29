# StayAutomated landing (ASI)

This repository is the **only production frontend** for the StayAutomated landing site. Treat it as the single source of truth; do not maintain parallel or legacy copies of this app.

| Context | Value |
|--------|--------|
| Cursor workspace root (this machine) | `C:\projects\asi-landing` |
| Vercel connected Git repository | `ASI-integration/asi-landing` |
| Vercel **Root Directory** | Repository root (`.`) |

Next.js App Router lives under `src/app/`. Route inventory: `docs/ROUTES.md`.

## Canonical RU residential calibration matrix

- **Canonical matrix**: `docs/location-validation/ru-residential-calibration-matrix.md`
- **Executable harness**: `src/lib/location/tests/ru-residential-calibration-matrix.test.ts`
- **Intent**: this is **not hardcoding final answers**; it encodes expected score bands/ranges, audiences, and forbidden verdicts to **prevent scoring regressions**.
- **Policy**: any change to RU location scoring/classification/sanity rules must pass this matrix.
