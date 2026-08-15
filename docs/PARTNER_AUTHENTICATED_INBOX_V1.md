# Partner Communication Brain v1

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
7. Server-only `partner_property_bindings` and `partner_booking_bindings`
   resolve the external IDs to an exact tenant-owned `properties.id` and
   canonical `booking_ops_records.id`. Missing, disabled, conflicting, or
   cross-tenant mappings fail closed.
8. The strict property loader verifies the canonical property against
   `properties(account_id, id)` and then reads only the exact active
   `tg_property_knowledge.property_id` row. It uses the canonical fields
   `wifi_name`, `wifi_password`, `wifi_notes`, `checkin_instructions`,
   `access_notes`, `door_code_notes`, `check_in_time`, `checkout_notes`,
   `check_out_time`, `parking_rules`, `parking_paid_or_free`,
   `parking_location_notes`, `house_rules`, and `quiet_hours`.
9. The deterministic partner-neutral brain recommends a bounded reply,
   clarification, escalation, or no action. It does not call an LLM.
10. Escalations reuse the existing durable handoff and action entities. The
    final recommendation is stored once in `partner_communication_decisions`,
    then the inbox event is marked processed.
11. The endpoint returns the stored recommendation and opaque audit reference.
    Exact replays return the same decision without another knowledge lookup,
    brain execution, turn, action, or handoff. Failed post-inbox processing can
    be retried safely.

Credentials must be provisioned separately. No credential-management API or UI
exists in v1. Plaintext bearer tokens are never stored; only deterministic
SHA-256 hashes of separately generated high-entropy tokens are persisted.

`auto_allowed` means only that the grounded recommendation is safe for the
authenticated partner caller to consider sending. It does not trigger delivery.

This input boundary has no real Apart Sharing adapter. The Apart Sharing demo
fixture, Apartment 101, network `ASI-Demo`, and password `demo-wifi-2026` are
synthetic test values only. No reply is sent to a guest, no provider or callback
is invoked, and no external operator or maintenance system is notified.

The partner path never imports or calls `communication/knowledge.ts`; therefore
its legacy `PROPERTY_DB` and `prop_A` fallback cannot enter a decision. That
legacy loader still uses stale `check_in_instructions` / `check_out_instructions`
names and remains reachable from older guest communication flows through
`communication/context.ts`, `communication-autopilot-v1-orchestrator.ts`, and
`communication/orchestrator.ts`. This task does not broaden into repairing those
legacy flows. The canonical schema fields for this path are
`checkin_instructions` and `checkout_notes`.

Migrations are append-only review artifacts. They are not automatically applied
to production, staging, or any other persistent environment.
