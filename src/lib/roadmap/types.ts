export type RoadmapStatus = 'done' | 'in_progress' | 'blocked' | 'later';

export type RoadmapPriority = 1 | 2 | 3 | 4 | 5;

export type RoadmapEvidence = {
  kind: 'code' | 'test' | 'docs' | 'ui' | 'api';
  path: string;
  note?: string;
};

export type RoadmapStage = {
  id: string;
  title: string;
  status: RoadmapStatus;
  currentState: string;
  nextStep: string;
  priority: RoadmapPriority;
  evidence: RoadmapEvidence[];
  dashboardHref?: string;
  blocker?: string;
  /** Near-term pilot-critical path; not every unfinished stage. */
  criticalForPilot?: boolean;
  lastReviewedAt: string;
};

export type RoadmapDepartment = {
  id: string;
  title: string;
  description: string;
  stages: RoadmapStage[];
};

export type RoadmapFilter = 'all' | RoadmapStatus;

export type RoadmapStatusCounts = Record<RoadmapStatus, number>;

export type RoadmapSummary = {
  lastAuditedAt: string;
  counts: RoadmapStatusCounts;
  total: number;
};
