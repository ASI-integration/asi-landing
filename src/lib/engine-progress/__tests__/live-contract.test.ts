import { describe, expect, it } from 'vitest';
import { checkConclusion, parseAsIStatusReport } from '../live-contract';

const report = `## ASI V13 — Strigunov G2 source campaign

Version: ASI_V13_20261112

| Slot | Task | State |
|---|---|---|
| 1 | asi-v13-g2-patch-integrity | RUNNING |
| 2 | asi-v13-g2-observer-identity | CI_PENDING |
| 3 | asi-v13-g2-host-recovery | CI_FAILED |
| 4 | asi-v13-g2-repair-admission | PENDING |
| 5 | asi-v13-g2-witness-race | RUNNING |

Model reservations: 6/10
GitHub reservations: 2/15

Published PRs:
- asi-v13-g2-host-recovery: https://github.com/ASI-integration/asi-landing/pull/619
`;

describe('ASI V13 owner-only monitor parsing', () => {
  it('extracts exactly five independent worker slots and reservation caps', () => {
    const result = parseAsIStatusReport(report);
    expect(result?.version).toBe('ASI_V13_20261112');
    expect(result?.workers.map(w => w.slot)).toEqual([1,2,3,4,5]);
    expect(result?.workers[0].state).toBe('RUNNING');
    expect(result?.workers[2].state).toBe('CI_FAILED');
    expect(result?.modelReservations).toBe(6);
    expect(result?.modelLimit).toBe(10);
    expect(result?.githubReservations).toBe(2);
    expect(result?.githubLimit).toBe(15);
    expect(result?.prLinks).toEqual([{
      taskId: 'asi-v13-g2-host-recovery',
      number: 619,
      url: 'https://github.com/ASI-integration/asi-landing/pull/619',
    }]);
  });

  it('rejects old campaign and unexpected number of slots instead of reporting false green', () => {
    expect(parseAsIStatusReport(report.replace('ASI_V13_20261112','ASI_V12_20261112'))).toBeNull();
    expect(parseAsIStatusReport(report.replace('## ASI V13','## ASI V12'))).toBeNull();
    expect(parseAsIStatusReport(report.replace('| 5 | asi-v13-g2-witness-race | RUNNING |',''))).toBeNull();
    expect(parseAsIStatusReport(report.replace('| 5 | asi-v13-g2-witness-race', '| 4 | asi-v13-g2-witness-race'))).toBeNull();
  });

  it('rejects over-limit and malformed budget figures', () => {
    expect(parseAsIStatusReport(report.replace('6/10','11/10'))).toBeNull();
    expect(parseAsIStatusReport(report.replace('2/15','300/15'))).toBeNull();
  });

  it('only allows exact trusted GitHub pull request URLs', () => {
    const modified = report.replace('https://github.com/ASI-integration/asi-landing/pull/619',
      'https://github.com.attacker.example/ASI-integration/asi-landing/pull/619');
    expect(parseAsIStatusReport(modified)?.prLinks).toEqual([]);
    expect(parseAsIStatusReport(report.replace('asi-v13-g2-host-recovery: https',
      'asi-v13-g2-forged: https'))?.prLinks).toEqual([]);
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
