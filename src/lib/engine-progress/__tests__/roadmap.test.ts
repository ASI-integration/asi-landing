import { describe, expect, it } from 'vitest';
import { ENGINE_MILESTONES, ENGINE_STEPS, ENGINE_ROADMAP_SNAPSHOT } from '../roadmap';

describe('ASI owner engine roadmap contract', () => {
  it('preserves 19 numbered milestones and 63 distinct real substeps', () => {
    expect(ENGINE_MILESTONES).toHaveLength(19);
    expect(ENGINE_STEPS).toHaveLength(63);
    expect(ENGINE_MILESTONES.map(m => m.id)).toEqual(Array.from({ length: 19 }, (_, i) => i + 1));
    expect(new Set(ENGINE_STEPS.map(s => s.id)).size).toBe(63);
    for (const s of ENGINE_STEPS) {
      expect(s.id).toMatch(/^([1-9]|1[0-9])\.[1-9][0-9]*$/);
      expect(Number(s.id.split('.')[0])).toBe(s.milestoneId);
      expect(s.title.length).toBeGreaterThan(4);
    }
    expect(ENGINE_ROADMAP_SNAPSHOT).toBe('2026-10-10');
  });
  it('labels old CI proofs as a dated snapshot, never promotes new-SHA success automatically', () => {
    const byId = new Map(ENGINE_STEPS.map(x => [x.id, x]));
    expect(byId.get('2.1')?.initialStatus).toBe('done');
    expect(byId.get('2.2')?.initialStatus).toBe('done');
    expect(byId.get('2.3')?.initialStatus).toBe('in_progress');
    expect(byId.get('2.4')?.initialStatus).toBe('not_started');
    for (const id of ['4.1','4.2','4.3','5.1','5.2','16.2'])
      expect(byId.get(id)?.initialStatus).toBe('blocked');
  });
  it('does not turn every future milestone green through planning defaults', () => {
    expect(ENGINE_STEPS.filter(s => s.initialStatus === 'done')).toHaveLength(5);
    expect(ENGINE_STEPS.find(s => s.id === '19.3')?.initialStatus).toBe('not_started');
  });
});
