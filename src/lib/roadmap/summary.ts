import type {
  RoadmapDepartment,
  RoadmapFilter,
  RoadmapStage,
  RoadmapStatus,
  RoadmapStatusCounts,
  RoadmapSummary,
} from './types';
import { ASI_PRODUCT_ROADMAP, ROADMAP_LAST_AUDITED_AT } from './asi-product-roadmap';

export function emptyStatusCounts(): RoadmapStatusCounts {
  return { done: 0, in_progress: 0, blocked: 0, later: 0 };
}

export function countStagesByStatus(stages: RoadmapStage[]): RoadmapStatusCounts {
  const counts = emptyStatusCounts();
  for (const stage of stages) {
    counts[stage.status] += 1;
  }
  return counts;
}

export function allRoadmapStages(
  departments: RoadmapDepartment[] = ASI_PRODUCT_ROADMAP,
): RoadmapStage[] {
  return departments.flatMap((department) => department.stages);
}

export function buildRoadmapSummary(
  departments: RoadmapDepartment[] = ASI_PRODUCT_ROADMAP,
  lastAuditedAt: string = ROADMAP_LAST_AUDITED_AT,
): RoadmapSummary {
  const stages = allRoadmapStages(departments);
  const counts = countStagesByStatus(stages);
  return {
    lastAuditedAt,
    counts,
    total: stages.length,
  };
}

export function filterStagesByStatus(
  stages: RoadmapStage[],
  filter: RoadmapFilter,
): RoadmapStage[] {
  if (filter === 'all') return stages;
  return stages.filter((stage) => stage.status === filter);
}

export function filterDepartments(
  departments: RoadmapDepartment[],
  filter: RoadmapFilter,
): RoadmapDepartment[] {
  if (filter === 'all') return departments;
  return departments
    .map((department) => ({
      ...department,
      stages: filterStagesByStatus(department.stages, filter),
    }))
    .filter((department) => department.stages.length > 0);
}

/** Department rollup: blocked > in_progress > later > done */
export function departmentOverallStatus(stages: RoadmapStage[]): RoadmapStatus {
  if (stages.some((s) => s.status === 'blocked')) return 'blocked';
  if (stages.some((s) => s.status === 'in_progress')) return 'in_progress';
  if (stages.some((s) => s.status === 'later')) return 'later';
  return 'done';
}

export function nearestFocusStages(
  departments: RoadmapDepartment[] = ASI_PRODUCT_ROADMAP,
  limit = 5,
): RoadmapStage[] {
  const actionable = allRoadmapStages(departments).filter(
    (stage) => stage.status === 'blocked' || stage.status === 'in_progress',
  );
  return [...actionable]
    .sort((a, b) => {
      if (a.priority !== b.priority) return a.priority - b.priority;
      if (a.status !== b.status) {
        if (a.status === 'blocked') return -1;
        if (b.status === 'blocked') return 1;
      }
      return a.title.localeCompare(b.title, 'ru');
    })
    .slice(0, limit);
}

export function assertUniqueStageIds(departments: RoadmapDepartment[]): string[] {
  const seen = new Set<string>();
  const duplicates: string[] = [];
  for (const stage of allRoadmapStages(departments)) {
    if (seen.has(stage.id)) {
      duplicates.push(stage.id);
    } else {
      seen.add(stage.id);
    }
  }
  return duplicates;
}

const VALID_STATUSES: ReadonlySet<string> = new Set([
  'done',
  'in_progress',
  'blocked',
  'later',
]);

export function assertValidStatuses(departments: RoadmapDepartment[]): string[] {
  const invalid: string[] = [];
  for (const stage of allRoadmapStages(departments)) {
    if (!VALID_STATUSES.has(stage.status)) {
      invalid.push(`${stage.id}:${String(stage.status)}`);
    }
  }
  return invalid;
}

const DASHBOARD_HREF_RE = /^\/dashboard(\/[\w\-./]*)?$/;

export function assertValidDashboardHrefs(
  departments: RoadmapDepartment[],
): string[] {
  const invalid: string[] = [];
  for (const stage of allRoadmapStages(departments)) {
    if (stage.dashboardHref && !DASHBOARD_HREF_RE.test(stage.dashboardHref)) {
      invalid.push(`${stage.id}:${stage.dashboardHref}`);
    }
  }
  return invalid;
}
