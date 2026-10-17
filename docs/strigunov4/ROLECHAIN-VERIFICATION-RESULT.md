# Fresh LOGIN role-chain denial verification

PASS: 64 separate genuine authenticator connections using the recoverable, recovery-issued lab credential. Every connection verified session_user=authenticator and current_user=anon or authenticated after SET LOCAL ROLE, before attempting its operation. Every operation was denied with exact SQLSTATE42501.

The matrix covers both synthetic account A and B scopes, SELECT/INSERT/UPDATE/DELETE, and account_members/properties/booking_ops_records/booking_ops_alerts. UPDATE attempts switch to the opposite account. Each connection starts a transaction; denial terminates the psql connection with ON_ERROR_STOP and rolls it back. No grants, roles, functions, policies or committed fixture rows were added. Explicit synthetic asi_reference values avoid sequence defaults.

These are restored table-ACL denials through a genuine limited LOGIN chain. They do not claim JWT user-identity RLS filtering or HTTP/API session validation; the restored ACL denies both tenant scopes. Service-role positive and ownership/revocation behavior was separately tested inside the migration rehearsal.

Full schema/history, all182 COPY tables/873 row values and all4sequence fingerprints remained unchanged. Optional repair version20260810280000 is absent from restored migration history (existence-only query). Initial read-only bridge attempt failed parsing the scalar EXISTS response before any matrix operation; the query was corrected to emit JSON and the complete matrix then passed.

Evidence: ROLECHAIN-VERIFICATION-38942690625.json; executed helper lab_rolechain_windows.py. Original source passwords were not recovered; the closed encrypted lab credential source and genuine logins are the proven scope.
