# Strigunov native Windows adapter hold — 2026-10-09

## Verdict and scope

CODE is a detached diagnostic/protocol implementation. Operational host, issuer,
IPC, protected store, target, PostgreSQL and launch remain BLOCK.
This is not an installer, privileged service, authorization issuer or DB runner.

Parent: PR #428, 94c32c4ee525cd0400a4cd9f548dd399caf56a81.
Stack branch: astra/strigunov-native-host-adapters-20261009.
The existing parent adapters, CLI, state model, file model and PostgreSQL
acquireTrustedHost rejection are unchanged. No application/DB integration exists.

## Native observation actually implemented

native-windows/Observer.cs uses read-only Win32/.NET APIs, not USERNAME, whoami,
a caller SID or a Node path-stat assertion:
- OpenProcessToken(TOKEN_QUERY), GetTokenInformation for actual user SID,
  integrity SID, elevation and authentication LUID.
- Current process ID, session and creation FILETIME; Toolhelp parent PID.
- QueryFullProcessImageName for the actual current executable.
- Local WMI LastBootUpTime before/after and GetTickCount64 uptime; local service
  membership count by observed process PID. No service configuration is changed.
- A fresh process-token handle after observation detects changed token identity.
- Strict local drive paths; no UNC, device path, ADS, wildcards, dot segments,
  trailing dots/spaces, oversized paths or missing files.
- Root-to-leaf CreateFile OPEN_EXISTING with READ_CONTROL/READ_ATTRIBUTES and
  leaf read access. FILE_FLAG_BACKUP_SEMANTICS + OPEN_REPARSE_POINT, share READ
  only; handles remain open across hashing/security checks and pathname reopens.
- Every opened component: GetFileInformationByHandle, reparse rejection,
  GetFinalPathNameByHandle name match, owner/DACL from GetSecurityInfo;
  leaf hard-link count one, 64 MiB bound; SHA-256 read through held handle.
- Recheck file IDs and security descriptor digests; reopen current names while
  original handles remain held to detect replacement.
- Conservative ACE screen includes inherited effective allow ACEs, write-data,
  append, attributes, EA, DELETE, DELETE_CHILD, WRITE_DAC, WRITE_OWNER and generic
  write/all. Unsupported/object/callback ACE forms deny the screening result.

The screen is NOT a complete AccessCheck/Authz proof. SYSTEM, Administrators and
TrustedInstaller are trusted for this diagnostic screen; a future service must
evaluate the specific caller token, groups, restricted token, privileges, owner
rights, mandatory integrity and effective delete/replace access. An administrator
can still control an ordinary checkout. No value here authorizes execution.

NativeDiagnostic.cs is a fixed read-only diagnostic executable. Focused tests
compile it with the already installed .NET Framework compiler into a unique
owned .native-probe-unit-* directory, with a minimal environment and timeout.
Its only modes are current-process observation and bounded owned-fixture path
checks. No shell, arbitrary script, arbitrary executable, SQL or kill request.
The compiler signature was observed Valid; the newly compiled diagnostic is
unsigned, uninstalled and untrusted as authority. There is no runtime launcher.

The initial PowerShell script attempt was blocked by Windows execution policy.
It was removed. No execution policy was changed or bypassed; final tests compile
and run the C# diagnostic directly without invoking a PowerShell script.

Actual local test observations:
token observed; before/after identity stable; boot timestamp stable;
eight path handles; executable observation DIAGNOSTIC_ONLY/ACL_POLICY_DENIED;
effectiveAccessProven=false; native owned junction/ADS/missing path rejected.
The ordinary owned fixture was observed diagnostically. No system ACL changed.

Boot timestamp/uptime are diagnostic observations, NOT a protected boot identity.
Service membership count is NOT service ownership/configuration attestation.
The parent PID is a snapshot, NOT a held authenticated parent process capability.
All handles are released before returning diagnostic JSON; no persistent trust
capability can be inferred. Access denied, unsupported API or partial observation
is HOST_AUTHN_UNAVAILABLE, never host authentication.

## Protected IPC

native-windows/ipc.ts accepts only bounded canonical versioned syntax:
CLAIM, STATUS, STOP or REQUEST_FAULT; request UUID, opaque lease/scope/nonce/
journal digests and distinct owner/custodian root references.
No clocks, counts, raw claims, approval flags, public/private keys, environment,
network address, DB URL, SQL, executable path or callbacks are accepted.

Fault kinds: commit-ack-loss, restart-replay, utc-boundary,
crm-receipt-atomicity. Every fault syntax includes run/fixture UUID, owned PID,
start/boot/binary digests and backend PID. These are correlations to compare
against future OS-held ownership, never proof from a client.

handleNativeRequest ignores both alleged body and peer and returns fixed
PROTECTED_SERVICE_NOT_INSTALLED, all I/O counters zero. It opens no pipe.
The CLI exits 2 even with poisoned flags/environment. The response validator
cannot accept CLAIMED, ISOLATED_ACCEPTED or PRODUCTION_RECEIPT.

Future independently installed native service must:
1. Protect service SID/account, SCM configuration, binary/build identity, public
   root store, every ancestor and IPC security descriptor.
2. Use GetNamedPipeClientProcessId/GetNamedPipeServerProcessId, held process
   handles and process creation identity. PID alone is insufficient.
3. Check ImpersonateNamedPipeClient success, OpenThreadToken identity and
   impersonation level; always RevertToSelf and fail closed if reversion fails.
4. Verify actual server token, pipe owner/DACL, local-only client restriction,
   exact service SID and restart identity; reject client JSON substitutes.
5. Keep owner/custodian approval keys outside the service. Provision only
   independently approved public roots and protected version/revocation state.
   Validate semantic owner artifacts, exact task/build/source/SHA/target and
   budgets before constructing an internal opaque lease. No exported factory.
6. Use service-owned wall/monotonic clocks and target observations. No wire event
   may report its own completion, time, authorization or observed resource count.

No root installation, key access, approval issuance, listener or real pipe
authentication occurred. PIPE_AUTHENTICATOR_NOT_INSTALLED remains explicit.

## Protected store and atomic commit requirement

protected-store/adapter.ts is a separate production-intended always-deny API.
claimLease, commitIntent, requestCleanup and requestStop cannot access a store
or acknowledge dispatch. recoverLease returns RECOVERY_REQUIRED with no reset.
It imports neither the parent unit-file-store nor any I/O/DB/process dependency.

The interface binds signed envelope and both semantic approval artifacts, root
versions/revocation epoch, nonce/run/namespace, exact native build/source and
host, target cluster, app/SQL, scenario/role sets and duration/query/write/row
budgets. Raw claims are not a service capability.

Required future atomic protocol, not implemented persistence:
1. Authenticate native service and OS-bound peer, verify independently installed
   distinct roots and exact signed scope; reject UNIT_ONLY domain everywhere.
2. Open protected journal/root with native handle/ACL checks; compare observed
   identity to installed pins and an external monotonic anchor.
3. In one protected serialized CAS transaction, compare expected generation/head,
   consume the globally unique nonce, reserve conservative dispatch budgets,
   append the intent digest and advance the external protected head.
4. Prove persistence of journal AND monotonic nonce/head/revocation state and
   directory entries; only then acknowledge the intent to the dispatcher.
5. Crash before/after journal, anchor, claim or ACK => quarantine uncertain state.
   If claim persisted and caller lost ACK, nonce stays consumed after restart.
   No age/PID/timeout-based lock stealing, automatic truncate or retry.
6. Revocation/STOP must persist before acknowledging and prevent new dispatch.
   Drain only already owned work; ambiguous commit becomes RECOVERY_REQUIRED.
7. Cleanup requires independently reconciled exact owned UUID AND consent digest,
   bounded counts and absence proof. A disputed ACK latches recovery. No broad
   scan/delete, cleanup-by-prefix, key/nonce reset or incident wipe.

An ordinary filesystem journal and colocated ACK cannot resist coordinated
rollback. Native file IDs/hash chains cannot replace a protected monotonic root.
Windows directory-entry power-loss durability is unresolved. No protected path,
SQL row or TPM was provisioned/accessed. Do not install the unit file store.

## Journal model and independent review findings

protected-store/journal-model.ts is a pure UNIT_ONLY transcript checker, not
persistence, a protected CAS implementation or trusted service callback.
The anchor is a separate TEST argument, not installed authority; if an attacker
can replace both model inputs, there is no external trust. No runtime imports it.

It checks scope and root binding, contiguous hash-linked rows, every ACK and exact
external model sequence/head; catches coordinated journal/ACK truncation against
the retained independent model anchor. It checks consumed nonce, revocation/
recovery flags, boot/time/duration/resource bounds, exact consent/UUID cleanup,
STOP and unresolved commit. It permits only EVIDENCE_REVIEW_REQUIRED after
nonempty resolved operations and per-scenario observation digests, never VERIFIED
or accepted evidence. Digests alone do not prove scenario semantics.

The PR #428 independent review identified:
- P1-01: parent model VERIFIED is reachable with no operations.
- P1-02: parent journal+ACK can be rolled back together.
- P1-03: parent model uses caller-supplied time, unsigned claims and zero rows.

Those inherited model files are outside this task's allowed edit scope and
remain unchanged. They remain BLOCK for production reuse, not silently fixed.
New detached model tests reject zero-operation finalization, anchored suffix
rollback and client-selected row/count fields; real IPC admits none of those
transitions or values. A real service must generate evidence and conservative
scenario-specific reservations internally. New model reservations (4 queries,
2 writes, 1 row per intent) are illustrative, NOT real harness quota sizing.

## Tests and evidence vocabulary

Focused command (22 new tests + 8 selected unchanged parent regressions = 30):

    node --import tsx --test --test-name-pattern="native:|two actual OS processes|lost caller ACK|crashed process|journal partial write|directory junction|invalid signature|expired or revoked|clock reversal" scripts/__tests__/strigunov-native-host-adapters.test.mjs scripts/__tests__/strigunov-lab-controller.test.mjs

Also npm.cmd run typecheck, ESLint on four new TS modules and the MJS test,
native compiler /warnaserror, git diff --check, exact scope review.
No broad suite or full 56-parent-test rerun. The selected parents cover actual
two-process contention, claim/restart ACK loss, partial append/crash, corruption,
junction/root identity, invalid signer and expired/revoked/reversed clocks.
Parent harness is exercised by new denial tests and fresh-process network/pg
canaries; its original separate 27-test file is not rerun within this budget.

Native OS observation: actual token/path APIs and owned fixture checks.
UNIT_ONLY: snapshot corruption, fake peer/keys, anchor, state/time/resource tests.
NOT_RUN: real service/pipe auth, AccessCheck, power loss, protected CAS/revocation,
independent real issuer, target DB, SQL, consent or isolated acceptance.
Canaries cover import networking/process calls and request-time filesystem calls;
they do not claim module loader performs no filesystem reads.

## Owner-gated next work and recovery

First obtain an independent review of the exact final native-adapter commit.
Then separately authorize a protected-service engineering/provisioning task:
reviewed signed immutable binary, protected service SID/account/configuration,
least-privilege effective ACL policy, OS-authenticated local IPC, independent
public-root provisioning/rotation/revocation, external monotonic nonce anchor,
power-loss/restart acceptance, exact-build binding and distinct receipt signer.
Do not wire the diagnostic observer or models into acquireTrustedHost.

Only after independent substrate acceptance, choose a genuinely empty exclusive
disposable lab cluster with a protected never-production/never-staging allowlist,
actual server/cluster/database/schema identity, roles/FORCE RLS and physical
egress/provider denial. Provisioning and actual two-connection DB execution each
require separate exact-scope owner/custodian authorization. None is granted here.

On ambiguity: halt dispatch, preserve journal/anchor/revocation records and owned
identities, quarantine nonce and target, request independent reconciliation.
Do not wipe state, regenerate a nonce, delete a lock, repair/truncate journal or
auto-retry uncertain work. This document contains no live enablement command.

## Primary API references

- https://learn.microsoft.com/en-us/windows/win32/api/fileapi/nf-fileapi-createfilew
- https://learn.microsoft.com/en-us/windows/win32/fileio/file-security-and-access-rights
- https://learn.microsoft.com/en-us/windows/win32/api/aclapi/nf-aclapi-getsecurityinfo
- https://learn.microsoft.com/en-us/windows/win32/api/securitybaseapi/nf-securitybaseapi-gettokeninformation
- https://learn.microsoft.com/en-us/windows/win32/api/winbase/nf-winbase-getnamedpipeclientprocessid
- https://learn.microsoft.com/en-us/windows/win32/api/winbase/nf-winbase-getnamedpipeserverprocessid
- https://learn.microsoft.com/en-us/windows/win32/api/namedpipeapi/nf-namedpipeapi-impersonatenamedpipeclient
