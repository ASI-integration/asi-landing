# Scoped Supabase TLS trust (diagnostic only)
Base PR468 bf16b68094cadcae018aa8946c058c9da72d18ca.
Prior protected38928455940 reported TLS, not its exact certificate cause.
Do not infer hostname/issuer failure until the new before/after evidence executes.

Provider CA obtained through HTTPS at:
https://supabase-downloads.s3-ap-southeast-1.amazonaws.com/prod/ssl/prod-ca-2021.crt
Official dashboard source for the URL:
https://github.com/supabase/supabase/blob/add223d7b31ca0cd64b389f4367b618e20b001cb/apps/studio/hooks/custom-content/custom-content.json
Provider guidance:
https://supabase.com/docs/guides/platform/ssl-enforcement

Pinned file SHA256700723581420dd1ac98fd7e9ac529f0ef210eadcaf87fc868a3ad7d114c2f3b7.
DER fingerprint807025ad50d4ed219d2c9c7d299c004f824eb00cf7f65afef607d07b72e6cafa.
Supabase Root2021CA; expiry2031-04-26. Public certificate only, no private key.
Its exact bytes are protected from newline conversion by local .gitattributes.

A temporary private bundle adds this pinned provider CA to the original system
roots. No machine trust configuration is changed. Both OpenSSL probes require
the actual validated host for SNI and hostname verification, with verification
errors fatal. Only safe DNS family flags, fixed error categories, verify numbers
and peer certificate hashes are emitted. Database credentials are never passed
to the TLS probe. No SQL if the scoped trust probe fails.

libpq keeps verify-full and uses the same temporary bundle. No require/verify-ca,
no hostname substitution, no trust of certificates merely received from peers.
The bundle is removed after the audit. Failure of one metadata query does not
mean a consistent full catalog exists; all16 and consistency review are required.

The existing main deployment workflow MUST receive exact reviewed checkout and
run_smoke_test=true. This hook always exits97 when invoked, before build/deploy.
Default-false historical workflow remains unsafe; no main/protection change here.

Tests include real isolated loopback PostgreSQL STARTTLS negotiation with
temporary certificates: trusted host PASS; untrusted chain BLOCK; wrong hostname
BLOCK. These are not proof of the real staging connection.

Security-complete backup/roles/ACL/owners/managed extensions, full restore,
minimal SQL approval, systemd rollback and real synthetic staging E2E remain
separate mandatory gates. No backup or deployment is performed by this patch.
