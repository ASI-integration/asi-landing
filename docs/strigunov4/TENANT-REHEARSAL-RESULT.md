# Local tenant authorization rehearsal

The corrected fixture suite passed inside the reviewed six-migration transaction, followed by unconditional ROLLBACK. No source database access or committed migrations occurred.

- Fourteen anon/authenticated table/RPC denials required SQLSTATE42501.
- Service-role cases rejected cross-account alert/actor, stale revision, account/property mismatch, revoked membership, and reassigned property ownership.
- Valid account-A acknowledgement succeeded, paused A automation, and left account B unchanged.
- These are SET LOCAL ROLE authorization checks, not fresh LOGIN or HTTP authentication evidence. Nine separate genuine LOGIN tests are recorded elsewhere.
- After rollback, schema/history fingerprints, all182 COPY table headers and873 sorted row values, and all4sequence states matched before execution.

The initial run passed fixture assertions but correctly returned BLOCK: three booking INSERT attempts invoked the asi_reference default, advancing public.asi_reservation_reference_seq from100007 to100010. PostgreSQL sequence advancement is not rolled back. The initial failed receipt is retained. Independently reviewed, authorized local reconciliation restored only that sequence to100007/calledtrue after exact archive/pre-fixture fingerprint, target identity, current-value and no-other-client checks; all4sequences then matched. The corrected fixture explicitly provides all three synthetic asi_reference values. Its subsequent successful run required unchanged sequence fingerprints without another correction.

RESTORE-COVERAGE-38942690625.json is a historical read-only diagnosis captured after the initial fixture and before explicit sequence reconciliation; its current_value100010 is not the final lab state. Its missing_copy_metadata is bound by the executed receiver query to realtime.messages. The final current sequence fingerprint is f878966fb013026a43dd8fd44c6e93e1e9ad09859d7ba8c2e9e6d744dc205444, verified by the correction and subsequent tenant/purpose receipts.

Coverage discrepancy is resolved: the183rd catalog table is realtime.messages, a partitioned parent (relkind p), with zero child partitions and zero rows. It has no extension ownership dependency. The182 archive COPY tables therefore cover all stored table data in this snapshot; no omitted rows were found in this residual check.

Evidence: TENANT-REHEARSAL-INITIAL-38942690625.json, SEQUENCE-RECONCILIATION-38942690625.json, RESTORE-COVERAGE-38942690625.json, TENANT-REHEARSAL-38942690625.json. Corrected fixture SHA2569efdc243d15c3c1f3a921176633c2a37ca64649c1a3b5c84557bd29d7d68bd88. The exact SQL is in the adjacent Astra runtime preparation directory.

This does not declare complete restore acceptance, original-password recovery, or live deployment readiness.
