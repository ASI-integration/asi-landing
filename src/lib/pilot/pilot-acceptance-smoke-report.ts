export type PilotSmokeBlockId =
  | 'setup'
  | 'link/redirect'
  | 'telegram memory'
  | 'property answers'
  | 'CRM events';

export type PilotSmokeBlockResult = {
  block: PilotSmokeBlockId;
  pass: boolean;
  failures: string[];
};

export function formatPilotSmokeSummary(results: PilotSmokeBlockResult[]): string {
  const lines = ['', '=== Pilot acceptance smoke v1 ==='];
  let allPass = true;

  for (const result of results) {
    const status = result.pass ? 'PASS' : 'FAIL';
    if (!result.pass) allPass = false;
    lines.push(`${status}  ${result.block}`);
    for (const failure of result.failures) {
      lines.push(`       - ${failure}`);
    }
  }

  lines.push(allPass ? 'OVERALL: PASS' : 'OVERALL: FAIL', '');
  return lines.join('\n');
}
