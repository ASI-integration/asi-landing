# Strigunov event handoff

The source of truth is launch issue #416:
https://github.com/ASI-integration/asi-landing/issues/416

This controller replaces hourly model-driven radar checks with a GitHub
Actions event listener. There is no cron job, hourly AI run, or production write.

## When it runs

- A Strigunov PR is merged.
- The PR Validation workflow completes for a Strigunov branch.
- The owner or agent updates/reopens the launch checklist in issue #416.
- A human dispatches the workflow explicitly.

Each event evaluates PR merge state and checklist gates. If the meaningful
next action did not change, no repeated notification is created. Otherwise
the controller adds an evidence-based handoff comment in issue #416.

The controller ALWAYS reports NOT READY. PR CI and issue checkboxes
alone cannot prove real CRM receipt, deployed version or publication approval.

## Operational limit

GitHub Actions events cannot directly wake Codex/Sol/Astra in an ordinary
ChatGPT Work session, nor remotely control a notebook without a separate
authorized local agent runner. This handoff nominates the next task;
it does not start coding agents. The execution bridge is separate work,
requiring explicit collision-avoidance and sandbox validation.

Never infer production readiness from passing checks. Before inviting
Strigunov's audience, independently verify privacy-safe production lead
delivery, actual operator-visible CRM receipt (without synthetic public
submissions), deployed version/health, mobile/legal/CTA and pilot terms.
Production releases, live-data verification and external publication need
separate owner approval.

## Verification

Run Node unit tests and syntax check for the event script.
PR Validation must pass before merge.
