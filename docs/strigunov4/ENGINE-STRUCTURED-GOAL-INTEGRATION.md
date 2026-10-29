# Bounded structured-goal integration

This source-only extension uses the existing product adapter, Global Dispatcher,
publication loop, Runner, Publisher, authority gate and Engine receipts. It does
not install a service, grant execution or accept a release milestone.

## Execution DAG

Inventory → structured goal/catalog validation → durable graph → existing
Dispatcher reservation → separate authority admission → local preparation and
independent verification → existing Publisher → verified receipt → dependent
selection. Native writes remain serialized. Independent preparation is bounded
by the existing adapter's explicit concurrency limit (1–4); reservations survive
restart and are never automatically replayed after an unknown outcome.

Source review and isolated acceptance can proceed independently of protected
host admission. Installation requires all of: final exact source review/CI,
protected integrated base, authenticated old-writer fencing, native systemd
isolation, exact signed install/activation/catalog and the intended App identity.
Only then may physical service/restart/end-to-end acceptance proceed.

## Implemented boundary

`decomposeProductGoal` compiles explicit acceptance criteria against a finite
trusted catalog. It selects coverage and dependency closure deterministically;
unknown or ambiguous criteria, cycles, unauthorized paths/tools and excessive
declared budgets fail closed. It never invents source code or capabilities.

The full immutable graph is retained in existing `routing.json` with its planned
and terminal checkpoints under the existing durable lock. Contract/graph changes
require reconciliation; a checksum is integrity checking, not authorization.
Historical failures remain failures. SIGKILL retains uncertain locks.

Optional `closedLoop.planning` binds that graph to the same native Beget catalog,
base, stage, paths and authorization window. Native admission still allows only
the existing two work orders, with one Publisher. Dependencies use validated
Engine receipts, not client-provided completion flags. Planning is advisory.

Declared compute costs are estimates checked before planning, not measured
aggregate CPU consumption. Native process timeouts remain separate. Actual API
request/mutation counters remain durable and authority-bound. Expiry/revocation
does not renew automatically; an indefinitely running process cannot extend a
finite task grant.

## Evidence and limits

Focused regressions cover decomposition, durable selection/restart, concurrent
independent private preparation, dependency blocking, authority/proof rejection,
SIGKILL, exact receipt retention and optional native-loop pending/resume across
two tasks. Local git preparations and Python checks are real; remote GitHub/CI
and authority ports in those tests are explicitly fixtures. These are not server
acceptance or physical power-loss tests.

No claim of free-form unknown-task generation, native parallel publication,
unattended authority renewal or physical 24/7 operation is made. The protected
provider-fencing evidence path still needs authenticated operator/provider proof;
an assertion, digest string or a different App's 404 is not that proof.

Do not install this source candidate until every protected gate passes. Preserve
the existing observer, staging, seven no-send restrictions, legacy receipts and
locks. G2 acceptance remains an independent product release.
