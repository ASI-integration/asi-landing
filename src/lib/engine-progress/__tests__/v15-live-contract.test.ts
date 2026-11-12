import { describe, expect, it } from 'vitest';
import { parseAsIStatusReport } from '../live-contract';

const firstWave = `## ASI V15 — autonomous five-agent continuous G2 engineering

Version: ASI_V15_20261112
Wave: 1/3
Scheduler: CURRENT_WAVE_NOT_TERMINAL

| Slot | Task | State |
|---|---|---|
| 1 | asi-v15-w01-host-error-recovery | RUNNING |
| 2 | asi-v15-w01-observer-inode | PENDING |
| 3 | asi-v15-w01-patch-byte-fidelity | CI_PENDING |
| 4 | asi-v15-w01-protected-repair | CI_PASS |
| 5 | asi-v15-w01-witness-locks | UNKNOWN_NO_REPLAY |

Model reservations: 10/30
GitHub effects: 3/90
Daily model reservation cap: 10

Verified PR receipts:
- asi-v15-w01-protected-repair: https://github.com/ASI-integration/asi-landing/pull/701
`;

const secondWave = firstWave
  .replace('Wave: 1/3', 'Wave: 2/3')
  .replace('| 5 | asi-v15-w01-witness-locks | UNKNOWN_NO_REPLAY |',
    `| 5 | asi-v15-w01-witness-locks | UNKNOWN_NO_REPLAY |
| 1 | asi-v15-w02-host-timeouts | RUNNING |
| 2 | asi-v15-w02-observer-marker-races | PENDING |
| 3 | asi-v15-w02-patch-invariants | CI_PENDING |
| 4 | asi-v15-w02-repair-unknown-outcomes | CI_PASS |
| 5 | asi-v15-w02-json-parser-hardening | UNKNOWN_NO_REPLAY |`)
  .replace('Model reservations: 10/30', 'Model reservations: 20/30')
  .replace('GitHub effects: 3/90', 'GitHub effects: 9/90')
  .replace('Verified PR receipts:',
    `Verified PR receipts:
- asi-v15-w02-repair-unknown-outcomes: https://github.com/ASI-integration/asi-landing/pull/702`);

describe('ASI V15 continuous fleet status contract', () => {
  it('parses a V15 wave with five distinct active slots and model limits', () => {
    const parsed = parseAsIStatusReport(firstWave);
    expect(parsed?.version).toBe('ASI_V15_20261112');
    expect(parsed?.wave).toBe(1);
    expect(parsed?.workers.map(w => w.slot)).toEqual([1,2,3,4,5]);
    expect(parsed?.workers[4].state).toBe('UNKNOWN_NO_REPLAY');
    expect(parsed?.modelReservations).toBe(10);
    expect(parsed?.modelLimit).toBe(30);
    expect(parsed?.githubReservations).toBe(3);
    expect(parsed?.githubLimit).toBe(90);
    expect(parsed?.prLinks.map(p => p.number)).toEqual([701]);
  });

  it('shows only the current five workers but retains earlier wave PR evidence', () => {
    const parsed = parseAsIStatusReport(secondWave);
    expect(parsed?.wave).toBe(2);
    expect(parsed?.workers).toHaveLength(5);
    expect(parsed?.workers.every(w => w.taskId.startsWith('asi-v15-w02-'))).toBe(true);
    expect(parsed?.modelReservations).toBe(20);
    expect(parsed?.prLinks.map(p => p.number)).toEqual([702,701]);
  });

  it('rejects malformed, incomplete and over-budget waves', () => {
    expect(parseAsIStatusReport(firstWave.replace('Wave: 1/3','Wave: 2/3'))).toBeNull();
    expect(parseAsIStatusReport(firstWave.replace('| 5 | asi-v15-w01-witness-locks | UNKNOWN_NO_REPLAY |',''))).toBeNull();
    expect(parseAsIStatusReport(firstWave.replace('10/30','31/30'))).toBeNull();
    expect(parseAsIStatusReport(firstWave.replace('3/90','91/90'))).toBeNull();
    expect(parseAsIStatusReport(firstWave.replace('asi-v15-w01-protected-repair | CI_PASS',
      'asi-v15-w02-protected-repair | CI_PASS'))).toBeNull();
  });

  it('rejects untrusted PR URLs and unrecognized campaign headers', () => {
    const forged = firstWave.replace(
      'https://github.com/ASI-integration/asi-landing/pull/701',
      'https://github.com.attacker.example/ASI-integration/asi-landing/pull/701');
    expect(parseAsIStatusReport(forged)?.prLinks).toEqual([]);
    expect(parseAsIStatusReport(firstWave.replace('ASI_V15_20261112', 'ASI_V16_20261112'))).toBeNull();
  });
});
