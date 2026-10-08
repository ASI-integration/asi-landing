import { existsSync } from 'node:fs';
import { resolve } from 'node:path';
import { describe, expect, it } from 'vitest';
import { ASI_PRODUCT_ROADMAP, ROADMAP_LAST_AUDITED_AT } from '../asi-product-roadmap';
import {
  allRoadmapStages,
  assertUniqueStageIds,
  assertValidDashboardHrefs,
  assertValidStatuses,
  buildRoadmapSummary,
  countStagesByStatus,
  criticalPilotPathStages,
  departmentOverallStatus,
  filterDepartments,
  filterStagesByStatus,
  nearestFocusStages,
} from '../summary';
import {
  ROADMAP_STATUS_ICON,
  ROADMAP_STATUS_LABELS,
  roadmapStatusColorClass,
} from '../status-ui';
import type { RoadmapStatus } from '../types';

const STATUSES: RoadmapStatus[] = ['done', 'in_progress', 'blocked', 'later'];

const REQUIRED_CRITICAL_IDS = [
  'crm-pilot-owner-activation',
  'prop-pricing-grid',
  'ch-live-core',
  'ch-initial-incremental-sync',
  'ch-first-real-adapter',
  'comm-production-llm',
  'comm-safe-auto-send',
  'comm-guest-lifecycle',
  'pilot-manual-e2e',
  'pilot-first-connected-object',
  'pilot-closed-3-5',
] as const;

describe('ASI product roadmap data integrity', () => {
  it('keeps unique stage IDs', () => {
    expect(assertUniqueStageIds(ASI_PRODUCT_ROADMAP)).toEqual([]);
  });

  it('only allows the four roadmap statuses', () => {
    expect(assertValidStatuses(ASI_PRODUCT_ROADMAP)).toEqual([]);
    for (const stage of allRoadmapStages()) {
      expect(STATUSES).toContain(stage.status);
    }
  });

  it('uses dashboard links under /dashboard when present', () => {
    expect(assertValidDashboardHrefs(ASI_PRODUCT_ROADMAP)).toEqual([]);
  });

  it('covers required departments A–J', () => {
    const ids = ASI_PRODUCT_ROADMAP.map((d) => d.id);
    expect(ids).toEqual([
      'crm-owners',
      'property-knowledge',
      'channel-ota',
      'bookings-calendar',
      'communication-minigpt',
      'legal-payments-mvd',
      'stay-flow',
      'ops-cleaning',
      'pilot-monetization',
      'runtime-dev-factory',
    ]);
  });

  it('requires evidence on every stage and prefers existing paths', () => {
    for (const stage of allRoadmapStages()) {
      expect(stage.evidence.length).toBeGreaterThan(0);
      expect(stage.title.length).toBeGreaterThan(0);
      expect(stage.currentState.length).toBeGreaterThan(0);
      expect(stage.nextStep.length).toBeGreaterThan(0);
      for (const item of stage.evidence) {
        if (item.path.includes('*') || item.path.endsWith('/')) continue;
        if (item.path.startsWith('src/') || item.path.startsWith('docs/')) {
          const absolute = resolve(process.cwd(), item.path);
          expect(existsSync(absolute), `${stage.id} missing evidence ${item.path}`).toBe(true);
        }
      }
    }
  });

  it('keeps Channel Manager critical path aligned with product focus', () => {
    const byId = Object.fromEntries(allRoadmapStages().map((s) => [s.id, s]));
    expect(byId['ch-manual-json-import']?.status).toBe('done');
    expect(byId['ch-live-core']?.status).toBe('in_progress');
    expect(byId['ch-live-core']?.priority).toBe(1);
    expect(byId['ch-live-core']?.criticalForPilot).toBe(true);
    expect(byId['ch-live-core']?.currentState).toMatch(/acceptance harness is available/i);
    expect(byId['ch-live-core']?.currentState).toMatch(/remains in progress until the harness is run successfully in production/i);
    expect(byId['ch-initial-incremental-sync']?.status).toBe('in_progress');
    expect(byId['ch-initial-incremental-sync']?.priority).toBe(1);
    expect(byId['ch-initial-incremental-sync']?.criticalForPilot).toBe(true);
    expect(byId['ch-initial-incremental-sync']?.currentState).toMatch(/initial sync/i);
    expect(byId['ch-initial-incremental-sync']?.currentState).toMatch(/Live Incremental Sync v1 is implemented/i);
    expect(byId['ch-initial-incremental-sync']?.currentState).toMatch(/not production-accepted/i);
    expect(byId['ch-initial-incremental-sync']?.currentState).toMatch(/Polling, webhooks/i);
    expect(byId['ch-reconciliation-recovery']?.status).toBe('in_progress');
    expect(byId['ch-reconciliation-recovery']?.currentState).toMatch(/Reconciliation & Recovery v1 is implemented/i);
    expect(byId['ch-reconciliation-recovery']?.currentState).toMatch(/not complete/i);
    expect(byId['ch-first-real-adapter']?.status).toBe('blocked');
    expect(byId['ch-first-real-adapter']?.priority).toBe(1);
    expect(byId['ch-outbound-publish']?.status).toBe('later');
    expect(byId['bk-booking-intake']?.status).toBe('done');
    expect(byId['bk-lifecycle']?.status).toBe('done');
    expect(byId['legal-e-sign']?.status).toBe('blocked');
    expect(byId['legal-payment-provider']?.status).toBe('blocked');
    expect(byId['legal-mvd-external-send']?.status).toBe('blocked');
    expect(byId['comm-production-llm']?.status).not.toBe('done');
    expect(byId['comm-guest-operational']?.status).toBe('done');
    expect(byId['comm-guest-long-term-memory']?.status).toBe('in_progress');
    expect(byId['comm-guest-long-term-memory']?.currentState).toMatch(/not production-accepted/i);
    expect(byId['comm-guest-lifecycle']?.status).toBe('in_progress');
    expect(byId['comm-guest-lifecycle']?.criticalForPilot).toBe(true);
    expect(byId['comm-guest-lifecycle']?.currentState).toMatch(/not production-accepted/i);
    expect(byId['rt-owner-console']?.status).toBe('done');
    expect(byId['rt-single-executor']?.status).toBe('done');
    expect(byId['rt-worker-pool']?.status).toBe('later');
    expect(ROADMAP_LAST_AUDITED_AT).toBe('2026-08-11');
  });

  it('marks the near-term pilot critical path without making every unfinished stage critical', () => {
    const byId = Object.fromEntries(allRoadmapStages().map((s) => [s.id, s]));
    for (const id of REQUIRED_CRITICAL_IDS) {
      expect(byId[id]?.criticalForPilot, id).toBe(true);
    }
    const criticalCount = allRoadmapStages().filter((s) => s.criticalForPilot).length;
    const unfinished = allRoadmapStages().filter((s) => s.status !== 'done').length;
    expect(criticalCount).toBeGreaterThanOrEqual(REQUIRED_CRITICAL_IDS.length);
    expect(criticalCount).toBeLessThan(unfinished);
    expect(byId['ch-outbound-publish']?.criticalForPilot).not.toBe(true);
    expect(byId['rt-worker-pool']?.criticalForPilot).not.toBe(true);
  });
});

describe('roadmap summary and filters', () => {
  it('counts all four statuses in the summary', () => {
    const summary = buildRoadmapSummary();
    expect(summary.lastAuditedAt).toBe(ROADMAP_LAST_AUDITED_AT);
    expect(summary.total).toBe(allRoadmapStages().length);
    expect(summary.counts.done + summary.counts.in_progress + summary.counts.blocked + summary.counts.later).toBe(
      summary.total,
    );
    for (const status of STATUSES) {
      expect(summary.counts[status]).toBeGreaterThan(0);
    }
  });

  it('filters stages and departments by status', () => {
    const stages = allRoadmapStages();
    for (const status of STATUSES) {
      const filtered = filterStagesByStatus(stages, status);
      expect(filtered.length).toBe(countStagesByStatus(stages)[status]);
      expect(filtered.every((s) => s.status === status)).toBe(true);
    }
    expect(filterStagesByStatus(stages, 'all')).toHaveLength(stages.length);

    const blockedDepartments = filterDepartments(ASI_PRODUCT_ROADMAP, 'blocked');
    expect(blockedDepartments.length).toBeGreaterThan(0);
    for (const department of blockedDepartments) {
      expect(department.stages.every((s) => s.status === 'blocked')).toBe(true);
    }
  });

  it('rolls up department status with blocked precedence', () => {
    expect(
      departmentOverallStatus([
        { status: 'done' } as never,
        { status: 'blocked' } as never,
        { status: 'in_progress' } as never,
      ]),
    ).toBe('blocked');
    expect(
      departmentOverallStatus([{ status: 'done' } as never, { status: 'later' } as never]),
    ).toBe('later');
  });

  it('returns nearest focus including Channel Manager sync follow-ups', () => {
    const focus = nearestFocusStages(ASI_PRODUCT_ROADMAP, 5);
    expect(focus.length).toBeGreaterThanOrEqual(3);
    expect(focus.length).toBeLessThanOrEqual(5);
    expect(focus.every((s) => s.status === 'blocked' || s.status === 'in_progress')).toBe(true);
    const focusIds = focus.map((s) => s.id);
    expect(focusIds).toContain('ch-live-core');
    expect(focusIds).toContain('ch-initial-incremental-sync');
    for (let i = 1; i < focus.length; i += 1) {
      expect(focus[i]!.priority).toBeGreaterThanOrEqual(focus[i - 1]!.priority);
    }
  });

  it('orders critical pilot path by priority and surfaces unfinished sync work', () => {
    const path = criticalPilotPathStages(ASI_PRODUCT_ROADMAP, 5);
    expect(path.length).toBeGreaterThan(0);
    expect(path.length).toBeLessThanOrEqual(5);
    expect(path.every((s) => s.criticalForPilot === true)).toBe(true);
    expect(path.every((s) => s.status === 'blocked' || s.status === 'in_progress')).toBe(true);
    const pathIds = path.map((s) => s.id);
    expect(pathIds).toContain('ch-live-core');
    expect(pathIds).toContain('ch-initial-incremental-sync');
    expect(pathIds).not.toContain('ch-outbound-publish');
    for (let i = 1; i < path.length; i += 1) {
      expect(path[i]!.priority).toBeGreaterThanOrEqual(path[i - 1]!.priority);
    }
  });
});

describe('roadmap status labels and icons', () => {
  it('exposes text labels and icons for every status (not color-only)', () => {
    for (const status of STATUSES) {
      expect(ROADMAP_STATUS_LABELS[status].length).toBeGreaterThan(0);
      expect(ROADMAP_STATUS_ICON[status].length).toBeGreaterThan(0);
      expect(roadmapStatusColorClass(status)).toMatch(/text-/);
    }
    expect(new Set(Object.values(ROADMAP_STATUS_ICON)).size).toBe(4);
  });
});
