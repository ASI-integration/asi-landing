# Claude Code — ASI repository instructions

Read and follow the root [AGENTS.md](AGENTS.md) before making changes. It is the shared instruction source for Codex, Claude and other agents; do not duplicate or override its safety, testing-budget, protected-branch, or release-gate rules.

In particular, follow **MCP / Desktop Commander efficiency (persistent across tasks)** in AGENTS.md: batch same-target read-only diagnostics/build/test steps, avoid repetitive status polling, inspect only targeted file ranges, and preserve independent authorization and fail-closed checks.
