# Current recovery status

Independent review: **RESTORE_PASS within the approved logical archive scope**, backup run 38942690625. This does not mean deployment or original source-password recovery.

The exact encrypted backup was recovered with the owner key. Database objects, owners, access rules, all 182 COPY blocks / 873 row values, four sequences and migration history were verified. Nine genuine LOGIN successes and nine wrong-password denials passed using recoverable owner-encrypted lab credentials. Tenant/RPC fixtures and 64 fresh authenticator role-chain CRUD denials passed. Final schema/history/data/sequence fingerprints remain at the restored baseline. Vault/Storage are explicitly empty in the checked snapshot.

Six migration candidates and the independently justified optional seventh purpose repair each passed rollback-only rehearsal. No migration was committed and no migration history was rewritten. The first tenant rehearsal consumed a sequence through a column default; its failed preservation receipt, exact reviewed correction and subsequent clean rerun are retained separately.

See INDEPENDENT-ACCEPTANCE-REVIEW.md, TENANT-REHEARSAL-RESULT.md, PURPOSE-REHEARSAL-RESULT.md and ROLECHAIN-VERIFICATION-RESULT.md. Raw per-phase NOT_PROVEN/BLOCK fields are historical evidence, not silently overwritten by the final verdict.

G0 application integration and actual release packaging are tracked in PR #473. Source original passwords, running HTTP/session/provider integration, protected staging apply, systemd backend and deployment are outside this archive verdict. Production, Sentinel and the live pilot were not changed.
