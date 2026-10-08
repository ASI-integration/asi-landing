# Public lead anti-abuse boundary

`POST /api/early-access/leads` has process-local defense in depth:

- salted contact fingerprints for hourly contact quotas;
- a short-lived salted submission fingerprint that coalesces concurrent and immediate retry duplicates;
- a global per-process quota;
- a failed CRM write is not cached as a success, so bounded retries remain possible while each attempt
  still consumes quota.

No raw contact, name, IP address, or CRM identifier is retained by these controls. The anonymous
response does not expose the CRM identifier.

## Residual P1: no cross-instance guarantee

The maps are not shared across Node.js processes and are cleared by restart. Therefore neither the
quota nor retry deduplication is a distributed guarantee. A retry routed to another process can still
create a duplicate CRM row. Closing this requires an approved database idempotency contract (for
example, a non-PII idempotency digest with a unique constraint) or a shared trusted rate-limit store.
No migration or infrastructure change is part of this task.

The route deliberately does not use `x-real-ip`, `x-forwarded-for`, or similar request headers for
security decisions: at application level it cannot prove that a trusted proxy overwrote client-supplied
values. A per-client edge limit may be added only together with verified proxy/header sanitization and
deployment configuration. Until then, do not describe this implementation as an edge or distributed
limiter.

The route's 4 KiB `Content-Length` check is an early rejection only. It is not an authoritative body-size
limit when the header is missing or transport uses chunking. Closing that edge-abuse gap requires a
verified reverse-proxy request-body limit or a separately reviewed bounded streaming parser; neither is
changed here.
