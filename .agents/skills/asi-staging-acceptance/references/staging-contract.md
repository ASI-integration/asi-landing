# Staging contract

Canonical staging identity for Agent OS v0 (non-secret):

| Field | Required value |
| --- | --- |
| Environment | `staging` |
| App path | `/var/www/asi-staging` |
| Port | `3001` |
| Domain | `staging.asi-global.ru` |
| Project ref | 20-character lowercase alphanumeric identifier |

Safety invariants:

- Staging credentials must be dedicated; production credentials are forbidden.
- Email auto-send stays disabled; Telegram outbound stays dry-run.
- Acceptance fixtures must be isolated, namespaced, and cleaned to zero residue.
- Deployment does not apply migrations.
- This Skill validates contracts locally and must not SSH or mutate staging.

Machine schemas:

- Fixture: `docs/agent-os/schemas/staging-fixture.schema.json`
- Shared validators: `scripts/agent-os/contracts.mjs`
