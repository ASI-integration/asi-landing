# Offline execution manifest binding

This is a prerequisite for a future protected staging backend, not that backend. It does not contact GitHub, a database or SSH, read credentials, extract an archive, register migrations, switch a release, or invoke systemd. The existing activation candidate remains unconditionally blocked.

## Interface

`scripts/strigunov4/execution_manifest.py` exposes:

```python
validate_manifest(manifest, expected_binding, package_manifest, sql_bytes, archive_stream)
```

`expected_binding` is explicit caller-owned reviewed context, independently selected by the calling process. Supplying a second matching JSON document is not an independent review or authorization. The CLI accepts `--manifest`, `--expected-binding`, `--package-manifest`, `--sql-root`, and `--archive`. It reads local files only. There is no execution option.

Manifest schema `asi.strigunov4.execution-binding.v1` contains exactly:

- `repository`: `ASI-integration/asi-landing`.
- `target`: staging, exact project `meeravcldnmocjtlqoeu`, service `asi-landing-staging`, release root `/var/www/asi-staging/releases`.
- `release`: actual integrated `gitSha`, `sourceTreeSha`, archive basename, SHA256, byte size and `sourceLockSha256`, matching the existing `package_g0.py` artifact-manifest interface. The historical G0 source SHA is not substituted for the integrated release SHA.
- `migrations`: ordered canonical `supabase/migrations/<14-digit-version>_<name>.sql` paths and SHA256s. The exact reviewed ordering is required; duplicate versions, unexpected or missing files, path traversal and SQL symlinks are rejected. Hashes cover exact bytes, without newline normalization.
- `provenance`: task ID/cycle, requested staging action, main workflow ref/SHA, run ID/attempt, artifact ID and review reference. These are correlated identifiers only, not authenticated provenance. The requested staging action is a local intent field; it neither adds nor changes the repository owner-gate schema.

The expected binding must match every field, including SQL order and provenance. The archive is streamed and checked for exact byte size and SHA256. SQL bytes are hashed. Duplicate JSON keys, unknown fields and receipt-style approval booleans are rejected.

Success is `BOUND_NOT_AUTHORIZED`, with `authorization:false`, `mutationAllowed:false`, and `provenanceAuthenticated:false`. Exit zero means byte binding only. Even if both JSON inputs are identical, no execution authority is created. Invalid inputs return a fixed BLOCK result without echoing values. The binding fingerprint is deterministic JSON with sorted keys; it is an identification digest, not a signature or attestation.

## Missing protected backend work

A future trusted caller must independently establish the repository/workflow identity, protected main ref and exact workflow code, environment approval and task-scoped owner authorization where applicable, artifact origin/digest, run attempt and one-time/current-cycle scope. It must bind those independently observed facts to these exact bytes and prevent stale/replayed approvals. Neither a JSON receipt nor GitHub run identifiers alone authenticate those facts. No authority adapter is implemented here.

That backend must separately implement reviewed selective schema/history application, fresh target/drift checks, safe immutable release extraction, effective no-send flags, staging service activation and application rollback. A migration rollback policy is distinct from application rollback. File validation is a snapshot; a future executor must retain/reverify immutable bytes at the use boundary. This module does not claim those controls or reopen already completed restore acceptance.

## Focused validation

Run `python -m unittest discover -s scripts/strigunov4 -p test_execution_manifest.py -v`.

Thirteen offline cases cover valid non-authorizing binding, forged receipt flags, repository/target mismatch, release/package mismatch, provenance changes and boolean IDs, SQL reorder, duplicate versions, unsafe paths/symlinks, SQL corruption/missing bytes, archive corruption, duplicate JSON keys, parser limits (excessive nesting and integer digits), and unknown/non-main provenance. No network or database fixtures are needed.
