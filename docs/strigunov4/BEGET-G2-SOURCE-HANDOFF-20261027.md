# S4-G2 Beget source/evidence report — 2026-10-27

Status: PARTIAL SOURCE PACKAGE / PHYSICAL BLOCKED. Not G2 ACCEPTED.

## Exact baseline and unchanged dependency
- main: c7e100d384b33822a91146824ef88199c68329bd.
- branch: astra/s4-g2-witness-tests-20261027 (fresh from main).
- #542 remains Draft at 2e2e19c5a7858776c07ff3b67d01eefb53bbebdb; no changes to its branch, exception or files.
- G1 accepted by canonical map, backed by run https://github.com/ASI-integration/asi-landing/actions/runs/40496122889 on a94cc12547038b865b2a50a23ade2810d5037f91.
- G2 remains IN_PROGRESS, G3 untouched. Local release checker without independent run evidence returned ACCEPTED_REQUIRES_INDEPENDENT_RUN_EVIDENCE, not proof that G1 is unaccepted.
- Main branch protection and current #542 check-runs were not independently established by the available combined-status response (empty statuses); do not infer CI PASS from that.

## Implemented scope
A separate Beget-only read-only operator witness and redacted receipt validator, with fixed host, unit, release and unit hash. No legacy mutation workflow is used.
It checks both effective lists INCLUDING the CRM OPERATOR_EMAIL alias used by src/lib/crm/access.ts, all seven flags, and before/after process identity.
It requires a separately approved root-owned /etc/asi-g2-witness-policy.json with exact pid, invocation, crm and ops fields; policy membership is NOT invented from the observed environment.
Policy and unit reads use directory descriptors, O_NOFOLLOW, root/non-writable ownership checks and read/inode race checks. Only approved labels and counts leave the witness.
No shell=True, target overrides, database client, HTTP client, write, sudo, restart or installer exists in this observer. CLI arguments/SSH_ORIGINAL_COMMAND are rejected.
This is source only. No policy, SSH key, sudoers or witness was installed. A future forced-command installation must pin the reviewed code and its imports/interpreter, deny arbitrary commands/forwarding, and require a new exact policy after PID/release changes.
The redacted receipt is not self-authenticating: consumers must bind it to the approved transport, source SHA, timestamp and current policy; it never proves human login.

## Tests and limitations
- Python witness: 14 test methods PASS, including per-field identity/flag subcases, missing/extra keys, unauthorized members/alias, malformed receipt, duplicate keys, no-privilege and argument rejection.
- Symlink denial test injects an open failure; actual privileged-host symlink/race acceptance is NOT proven. PID race is fixture-tested; privileged filesystem race testing remains outstanding.
- GIS: 10 deterministic Node tests PASS against the exact #542 component fixture (SHA256 571c26ae0db0f169788c634c4c0ae8787a26da4ceb1adf60b0b5d613e807ea6c).
- GIS tests execute the extracted, TypeScript-transpiled effect with mocked GIS/fetch; they do NOT mount React in a real browser and are not human acceptance.
- Nine tests cover visible-host contract, mount/no implicit POST, callback POST, missing credential, server failure, loader failure, unmount, remount and redirect-mode preservation.
- The tenth test REPRODUCES A DEFECT, not a safety PASS: a request already in flight still calls router.push after cleanup. #542 checks cancelled before the request but not after await. Recommendation: post-await cancelled/isMounted guard in a separately authorized update; do not mutate its SHA-bound approval here.
- No real credentials or Google calls were made. Existing session reuse and actual browser redirects remain physically unproven.
- Existing auth tests: 4 PASS / 1 FAIL. Session route test has a stale exact expectation missing ruCommercialPilot:null; production route is unchanged. Do not suppress this failure.
- Focused ESLint on new GIS test: PASS. git diff --check: PASS.
- Typecheck failed at the Node 256 MiB heap limit. Worker cgroup memory.max=536870912. Build began but produced no terminal result and its process disappeared during Desktop Commander reconnection. Build is UNKNOWN/incomplete; no blind retry or service memory changes.
- Staging stayed active, PID 46657, invocation 4fe48ea3b5d4426483380dcaa21c5947, NeedDaemonReload=no. Old PID1234 is stale and is not used as current proof.
- asi-dc cannot read /proc/1234/environ; observer itself rejects unprivileged execution before any private read. Effective current process allowlists/flags were NOT read.

Reproduce offline from repository root:
```sh
python3 -m unittest discover -s scripts/strigunov4 -p test_beget_g2_operator_witness.py -v
node --test scripts/strigunov4/test_beget_g2_gis.mjs
npx eslint scripts/strigunov4/test_beget_g2_gis.mjs
npx vitest run src/app/api/auth/google/__tests__/oauth-redirect.test.ts src/app/api/auth/session/__tests__/route.test.ts
npm run typecheck
npm run build
```
Do not run resource-heavy checks on the constrained live-server DC worker again; use the approved isolated CI capacity. Tests have no live credentials.

## HTTP proof (GET only, no cookies, no redirects followed)
Observed 2026-10-27 16:37:56 Moscow from asi-dc.
All URLs use https://g2.asi-global.ru.

| Path | Result |
|---|---|
| /ru/connect | 200 |
| /api/health | 200, ok=true |
| /api/version | 200, staging, d912aec6663de90e5ca4293cc5a69e2e0ed9ff94 |
| /api/public-config | 200, configured=true, mode=gis; client identifier omitted |
| /api/auth/session | 200, user=null (anonymous) |
| /dashboard/crm/queue | 200 page shell; NOT evidence of operator permission |
| /api/dashboard/crm/queue | 401 |
| /api/dashboard/booking-ops | 401 |

The API GET handlers check session before records access. No guest identifiers were requested and no returned record content was read. No POST, login, SQL, send or payment was performed. GET application logging is not claimed absent.
Public HTTP does not independently attest process flags, kernel filters or authenticated roles.

## Human/server handoff
One next decision: review this final Draft scope and the #542 race finding before approving any G2 rollout.
All five new paths are outside the release map enumerated G2 files and need an owner RELEASE-EXCEPTION bound to this PR's exact final HEAD; this is NOT merge/deploy permission.
After separately approved remediation and G2-only deployment of the visible-button version:
1. Owner opens https://g2.asi-global.ru/ru/connect in ordinary Firefox and clicks the genuine visible Google-rendered button. No synthetic click, token injection or automated login.
2. Owner verifies expected account/session and intended destination locally. Do not copy cookies, tokens, client identifiers or account details into the PR.
3. An independently approved narrowly restricted witness checks current PID/invocation/release, exact approved effective membership in BOTH lists, seven flags, and existing egress protections. Do not extend asi-dc rights.
4. Confirm CRM/OPS access without creating bookings, tasks, sends or payments; also preserve anonymous-denial proof.
5. Bind source/run/policy and human attestation to a fresh receipt; only then consider separately authorized G2 acceptance. Fixture counts and HTTP200 alone never open G3.

No merge, deployment, protected dispatch, service/role/OAuth/DNS/environment edits, Windows/USB dependency, CodeRabbit request, PR531 mutation, lock reset or live action was performed.
