# Executed PostgreSQL concurrency regression

PASS on PostgreSQL17.6 in a new disposable container, with synthetic structural tables only. The existing restored database, source database and credentials were not accessed.

Two real psql sessions called create_booking_availability_hold_atomic_account_v1 as service_role for the same account/property/date interval using different input forms and distinct idempotency keys. Session A used the setup UUID, returned active, and held its transaction open. Session B used the direct property ID.

- Historical function: B returned active and committed while A's transaction was still open. The overlapping-hold race was reproduced.
- Forward correction: B was observed in pg_stat_activity waiting on an advisory lock. After A committed, B resumed and returned conflict.
- CREATE OR REPLACE preserved the function owner and ACL.

Pinned image docker.io/supabase/postgres@sha256:5a4314708484bec672de2c09653a5c01fb1c84a998564ac231b0325e2238ed5b; network none, no exposed ports, user100:101, requested memory cap512MiB, read-only rootfs, no capabilities, no-new-privileges, pids128. The uniquely labelled test container and its dedicated volume were removed in finally; both removals succeeded. This test intentionally uses minimal synthetic schema and proves the actual RPC concurrency behavior, not complete application acceptance.

Published durable sources are scripts/strigunov4/availability-lock/run_lock_regression.py (WSL receiver), synthetic-schema.sql, old-function.sql, and supabase/migrations/20261016203000_booking_availability_canonical_lock.sql. The owner-side binary-stdin wrapper used for this execution remains a local orchestration record. Exact input hashes and executed container identity are recorded in LOCK-REGRESSION-RESULT.json. All source SQL fixtures are nonsensitive. No historical migration or restore receipt was rewritten.
