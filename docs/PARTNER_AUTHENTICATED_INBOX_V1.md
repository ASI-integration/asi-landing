# Partner Authenticated Inbox v1

`POST /api/partner/v1/communication/events` is the partner-neutral,
server-to-server input boundary for Partner Communication Contract v1.

The request flow is:

1. A partner sends a bearer token and `X-ASI-Partner-Credential` identifier.
2. The server hashes the bearer token with SHA-256 and verifies the stored hash.
3. The credential resolves its server-side `partner_account_bindings` row and
   canonical `accounts.id`. Request-body identity never selects the ASI tenant.
4. Only after authentication, the route parses and validates the normalized
   Partner Communication Contract v1 body. Its external partner/account values
   must exactly match the authenticated binding.
5. The normalized event is inserted or reused in
   `partner_communication_inbox`. The raw HTTP body, headers, tokens, and
   arbitrary provider payloads are not stored.
6. The existing durable Partner Communication state repository creates or
   reuses the tenant-scoped session and inbound turn.
7. The endpoint returns an opaque audit reference and a contract-level
   `no_action` acknowledgement. Exact processed replays do not repeat state
   side effects; failed post-inbox processing can be retried by exact replay.

Credentials must be provisioned separately. No credential-management API or UI
exists in v1. Plaintext bearer tokens are never stored; only deterministic
SHA-256 hashes of separately generated high-entropy tokens are persisted.

This input boundary has no Apart Sharing integration. The synthetic fixture is
test-only. No AI reply is executed, no outbound delivery occurs, and no external
provider is called. Migrations are committed as append-only artifacts and are
not automatically applied to production or any other persistent environment.
