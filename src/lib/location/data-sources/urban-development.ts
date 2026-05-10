import type { ConfidenceLevel } from '../report-contract';

export type UrbanDevelopmentSourceType =
  | 'public_urban_planning_data'
  | 'open_city_development_source'
  | 'construction_planning_signal'
  | 'planned_infrastructure';

export interface UrbanDevelopmentSourceReference {
  sourceType: UrbanDevelopmentSourceType;
  title: string;
  url?: string;
  retrievedAtIso?: string;
  note?: string;
}

export interface PlannedConstructionProject {
  title: string;
  category: 'residential' | 'commercial' | 'mixed_use' | 'public_space' | 'unknown';
  distanceM?: number;
  expectedTimeHorizon?: string;
  source: UrbanDevelopmentSourceReference;
  confidence: ConfidenceLevel;
  sourceReliability: ConfidenceLevel;
  notes: string[];
}

export interface PlannedInfrastructureChange {
  title: string;
  kind: 'road' | 'public_transport' | 'rail' | 'pedestrian' | 'utility' | 'unknown';
  expectedTimeHorizon?: string;
  source: UrbanDevelopmentSourceReference;
  confidence: ConfidenceLevel;
  sourceReliability: ConfidenceLevel;
  potentialImpact: 'positive' | 'negative' | 'mixed' | 'unknown';
  notes: string[];
}

export interface ZoningPlanningNote {
  title: string;
  zoningType?: string;
  source: UrbanDevelopmentSourceReference;
  confidence: ConfidenceLevel;
  sourceReliability: ConfidenceLevel;
  notes: string[];
}

export interface UrbanDevelopmentSignalsSnapshot {
  plannedConstructionProjects: PlannedConstructionProject[];
  infrastructurePlans: PlannedInfrastructureChange[];
  roadTransportChanges: PlannedInfrastructureChange[];
  zoningPublicPlanningNotes: ZoningPlanningNote[];
  sources: UrbanDevelopmentSourceReference[];
}
