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

export type DevelopmentReadinessSnapshot = {
  schemaVersion: 'asi.owner-console.readiness.v1';
  overallState: DevelopmentReadinessState;
  canLaunch: boolean;
  checkedAt: string;
  components: Record<DevelopmentReadinessComponentId, DevelopmentReadinessComponent>;
};
