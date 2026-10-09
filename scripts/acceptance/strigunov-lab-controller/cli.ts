/** Untrusted CLI: no IPC connection or live execution command is available. */
export function planControllerRequest(_arguments?: unknown) {
  return Object.freeze({ state: 'PLAN_ONLY', verdict: 'BLOCK', reason: 'CONTROLLER_NOT_INSTALLED',
    executionAuthorized: false, sqlCalls: 0, databaseCalls: 0, realMessageCalls: 0 });
}
if (typeof require !== 'undefined' && require.main === module) {
  // Includes --execute, --dry-run, --approved, supplied roots and poisoned environment.
  console.log(JSON.stringify(planControllerRequest()));
  process.exitCode = 2;
}
