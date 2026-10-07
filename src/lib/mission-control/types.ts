export const MISSION_CONTROL_PROJECT_IDS = ['kim', 'asi', 'oris'] as const;

export type MissionControlProjectId = typeof MISSION_CONTROL_PROJECT_IDS[number];

export type MissionControlStatusKind = 'running' | 'waiting' | 'error' | 'done' | 'idle';

export type MissionControlStatusPayload = {
  projectId: MissionControlProjectId;
  status: MissionControlStatusKind;
  stage: string;
  progressPercent: number | null;
  stageProgressPercent: number | null;
  completedItems: number;
  totalItems: number;
  currentItem: string;
  speed: string;
  eta: string;
  lastEvent: string;
  updatedAt: string;
};

export type MissionControlStoredStatus = MissionControlStatusPayload & {
  receivedAt: string;
};

export type MissionControlDashboardProject = MissionControlStoredStatus & {
  name: string;
  stale: boolean;
  ageSeconds: number;
};

export const MISSION_CONTROL_PROJECT_NAMES: Record<MissionControlProjectId, string> = {
  kim: 'KIM',
  asi: 'ASI ENGINE',
  oris: 'ORIS',
};
