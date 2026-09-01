export const DEVELOPMENT_READINESS_COMPONENTS = [
  'bridge',
  'checkouts',
  'baseline',
  'executor',
  'github',
] as const;

export type DevelopmentReadinessComponentId = typeof DEVELOPMENT_READINESS_COMPONENTS[number];
export type DevelopmentReadinessState = 'ready' | 'blocked' | 'degraded';

export type DevelopmentReadinessComponent = {
  state: DevelopmentReadinessState;
  reasonCode: string;
  message: string;
  blockingLaunch: boolean;
};

export type DevelopmentReadinessRunnerEvidence = {
  identity: string;
  checkedAt: string;
  expiresAt: string;
  schemaVersion: 'asi.runtime.runner-readiness.v1' | 'asi.runtime.runner-readiness.v2';
  repositoryId: string;
  canonicalRepository: string;
  observedBaselineSha: string | null;
  verifiedBaselineSha: string | null;
  readinessState: DevelopmentReadinessState;
  blockingReason: string | null;
  evidenceAgeMs: number;
};

export type DevelopmentReadinessSnapshot = {
  schemaVersion: 'asi.owner-console.readiness.v1';
  overallState: DevelopmentReadinessState;
  canLaunch: boolean;
  checkedAt: string;
  runnerEvidence: DevelopmentReadinessRunnerEvidence | null;
  components: Record<DevelopmentReadinessComponentId, DevelopmentReadinessComponent>;
};
