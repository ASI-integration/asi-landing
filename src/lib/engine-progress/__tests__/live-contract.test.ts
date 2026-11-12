import { describe, expect, it } from 'vitest';
import { checkConclusion, parseAsIStatusReport } from '../live-contract';

const report = `## ASI V14 — Strigunov G2 source campaign

Version: ASI_V14_20261112

| Slot | Task | State |
|---|---|---|
| 1 | asi-v14-g2-host-error-recovery | RUNNING |
| 2 | asi-v14-g2-json-boundary | UNKNOWN_NO_REPLAY |
| 3 | asi-v14-g2-unicode-normalization | CI_FAILED |
| 4 | asi-v14-g2-patch-safety | PENDING |
| 5 | asi-v14-g2-marker-classification | RUNNING |

Model reservations: 6/10
GitHub reservations: 2/15

Published PRs:
- asi-v14-g2-unicode-normalization: https://github.com/ASI-integration/asi-landing/pull/619
`;

describe('ASI V14 owner-only monitor parsing', () => {
  it('extracts exactly five independent worker slots and reservation caps', () => {
    const result = parseAsIStatusReport(report);
    expect(result?.version).toBe('ASI_V14_20261112');
    expect(result?.workers.map(w => w.slot)).toEqual([1,2,3,4,5]);
    expect(result?.workers[0].state).toBe('RUNNING');
    expect(result?.workers[1].state).toBe('UNKNOWN_NO_REPLAY');
    expect(result?.workers[2].state).toBe('CI_FAILED');
    expect(result?.modelReservations).toBe(6);
    expect(result?.modelLimit).toBe(10);
    expect(result?.githubReservations).toBe(2);
    expect(result?.githubLimit).toBe(15);
    expect(result?.prLinks).toEqual([{
      taskId: 'asi-v14-g2-unicode-normalization',
      number: 619,
      url: 'https://github.com/ASI-integration/asi-landing/pull/619',
    }]);
  });

  it('rejects old campaign and unexpected number of slots instead of reporting false green', () => {
    expect(parseAsIStatusReport(report.replace('ASI_V14_20261112','ASI_V13_20261112'))).toBeNull();
    expect(parseAsIStatusReport(report.replace('## ASI V14','## ASI V13'))).toBeNull();
    expect(parseAsIStatusReport(report.replace('| 5 | asi-v14-g2-marker-classification | RUNNING |',''))).toBeNull();
    expect(parseAsIStatusReport(report.replace('| 5 | asi-v14-g2-marker-classification', '| 4 | asi-v14-g2-marker-classification'))).toBeNull();
  });

  it('rejects over-limit and malformed budget figures', () => {
    expect(parseAsIStatusReport(report.replace('6/10','11/10'))).toBeNull();
    expect(parseAsIStatusReport(report.replace('2/15','300/15'))).toBeNull();
  });

  it('only allows exact trusted GitHub pull request URLs', () => {
    const modified = report.replace('https://github.com/ASI-integration/asi-landing/pull/619',
      'https://github.com.attacker.example/ASI-integration/asi-landing/pull/619');
    expect(parseAsIStatusReport(modified)?.prLinks).toEqual([]);
    expect(parseAsIStatusReport(report.replace('asi-v14-g2-unicode-normalization: https',
      'asi-v14-g2-forged: https'))?.prLinks).toEqual([]);
  });

  it('never counts skipped or absent CI as passed', () => {
    expect(checkConclusion('success','completed')).toBe('passed');
    expect(checkConclusion('failure','completed')).toBe('failed');
    expect(checkConclusion('cancelled','completed')).toBe('failed');
    expect(checkConclusion(null,'in_progress')).toBe('pending');
    expect(checkConclusion('skipped','completed')).toBe('unknown');
    expect(checkConclusion(undefined,'completed')).toBe('unknown');
  });
});
