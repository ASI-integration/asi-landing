import { describe, expect, it } from 'vitest';
import { checkConclusion, parseAsIStatusReport } from '../live-contract';

// Matches the actual private GitHub report body produced by the V14 recovery supervisor.
const report = `## ASI V14 recovered Codex results — Grok/PR campaign

Version: ASI_V14_CODEX_SALVAGE_20261112

| Slot | Task | Status |
|---|---|---|
| 1 | asi-v14-g2-host-error-recovery | UNKNOWN_NO_REPLAY |
| 2 | asi-v14-g2-json-boundary | CI_PASS |
| 3 | asi-v14-g2-unicode-normalization | CI_PASS |
| 4 | asi-v14-g2-patch-safety | CI_PENDING |
| 5 | asi-v14-g2-marker-classification | CI_PASS |

New Grok reservations: 5/5
New GitHub effects: 8/10
Codex calls in recovery: ZERO

Draft PR receipts:
- asi-v14-g2-json-boundary: https://github.com/ASI-integration/asi-landing/pull/623
- asi-v14-g2-unicode-normalization: https://github.com/ASI-integration/asi-landing/pull/621
- asi-v14-g2-patch-safety: https://github.com/ASI-integration/asi-landing/pull/624
- asi-v14-g2-marker-classification: https://github.com/ASI-integration/asi-landing/pull/622
`;

describe('ASI V14 recovery owner monitor parsing', () => {
  it('parses five scoped task states, the new capped Grok quota and four genuine PR receipts', () => {
    const parsed = parseAsIStatusReport(report);
    expect(parsed?.version).toBe('ASI_V14_CODEX_SALVAGE_20261112');
    expect(parsed?.workers.map(w => w.slot)).toEqual([1,2,3,4,5]);
    expect(parsed?.workers[0].state).toBe('UNKNOWN_NO_REPLAY');
    expect(parsed?.workers[1].state).toBe('CI_PASS');
    expect(parsed?.workers[3].state).toBe('CI_PENDING');
    expect(parsed?.modelReservations).toBe(5);
    expect(parsed?.modelLimit).toBe(5);
    expect(parsed?.githubReservations).toBe(8);
    expect(parsed?.githubLimit).toBe(10);
    expect(parsed?.prLinks.map(pr => pr.number)).toEqual([623,621,624,622]);
  });

  it('rejects exhausted original V14 status, other campaigns and missing worker slots', () => {
    expect(parseAsIStatusReport(report.replace('ASI_V14_CODEX_SALVAGE_20261112','ASI_V14_20261112'))).toBeNull();
    expect(parseAsIStatusReport(report.replace('## ASI V14 recovered','## ASI V14 original'))).toBeNull();
    expect(parseAsIStatusReport(report.replace('| 5 | asi-v14-g2-marker-classification | CI_PASS |',''))).toBeNull();
    expect(parseAsIStatusReport(report.replace('| 5 | asi-v14-g2-marker-classification','| 4 | asi-v14-g2-marker-classification'))).toBeNull();
  });

  it('rejects allocations exceeding caps and malicious PR destinations', () => {
    expect(parseAsIStatusReport(report.replace('5/5','6/5'))).toBeNull();
    expect(parseAsIStatusReport(report.replace('8/10','11/10'))).toBeNull();
    const malformed = report.replace('https://github.com/ASI-integration/asi-landing/pull/623',
      'https://github.com.attacker.example/ASI-integration/asi-landing/pull/623');
    expect(parseAsIStatusReport(malformed)?.prLinks.map(p => p.number)).not.toContain(623);
  });

  it('does not treat skipped or unknown check conclusions as passing', () => {
    expect(checkConclusion('success','completed')).toBe('passed');
    expect(checkConclusion('failure','completed')).toBe('failed');
    expect(checkConclusion(null,'in_progress')).toBe('pending');
    expect(checkConclusion('skipped','completed')).toBe('unknown');
    expect(checkConclusion(undefined,'completed')).toBe('unknown');
  });
});
