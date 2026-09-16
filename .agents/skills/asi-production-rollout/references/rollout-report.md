# Rollout report

For Agent OS v0, the Skill returns a preflight-only report. It must never claim deploy, migration, or mutation success.

Minimum fields:

```json
{
  "schemaVersion": "asi.agent-os.production-rollout-report.v1",
  "status": "PREFLIGHT_ONLY",
  "requestedAction": "production_deploy",
  "target": "production",
  "requestedSha": "<40-hex>",
  "sourceSha": "<40-hex>",
  "identityMatched": true,
  "dispatchAllowed": false,
  "mutationAllowed": false,
  "ownerGateStatus": "missing",
  "evidence": ["..."]
}
```

Status values:

- `PREFLIGHT_ONLY` — identity checked; no approval yet or approval not required for tabletop
- `AWAITING_OWNER` — ready package waiting for exact owner gate
- `BLOCKED` — identity/action mismatch or unsafe input

Never set status to `DONE` for a production write from this Skill.
