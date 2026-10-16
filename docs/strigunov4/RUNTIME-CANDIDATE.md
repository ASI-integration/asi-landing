# Isolated restore runtime: executed candidate

The owner-local WSL2 lab and pinned Supabase PostgreSQL 17.6 image are now provisioned and tested. See RUNTIME-EXECUTION-RESULT.md for exact installation, isolation, image, extension and empty-cluster evidence. The historical WSL-NEXT-ACTION.md records the earlier installation checkpoint.

Actual archive import has since completed successfully in a separate labelled target. Full security acceptance remains pending; RESTORE-EXECUTION-PLAN.md records the current verification stage.

The original unique-bootstrap-administrator proposal was tested and rejected: PostgreSQL 17 cannot reproduce the archive's role grantors that way. The reviewed source-specific procedure initializes supabase_admin as bootstrap role OID 10 and replaces exactly one already-satisfied CREATE ROLE statement in a private execution copy with an identity assertion. The immutable original globals archive and every ALTER ROLE and membership statement remain unchanged. No blanket SQL filtering or ignored errors are permitted.

A further archive-derived comparison identified 51 extension-member ownership differences after ordinary pg_restore. These require an exact object manifest and ownership/ACL reconciliation before accepting the restored schema. Successful pg_restore alone is not the acceptance gate.

Credentials and any source Vault encryption keys are separate from the CMS archive key. Recovery-issued local credentials must be labelled as such; they do not prove recovery of original application secrets. The source archive contains zero vault.secrets rows. Required authorization and credential checks remain explicit in the restore plan.
