# Result contract

Return a JSON artifact conforming to `docs/agent-os/schemas/task-result.schema.json`, followed by a concise human summary.

Required evidence:

- status, branch, full commit SHA and draft PR URL when published;
- exact changed files;
- each check as `PASS`, `FAIL`, or justified `SKIP`;
- explicit booleans for production, database, secrets, DNS, payments, real messages, and approved UX side effects;
- blockers and exactly one next owner decision, or `null` when none is required.

Never report `DONE` when a required check failed or a mandatory action remains.
