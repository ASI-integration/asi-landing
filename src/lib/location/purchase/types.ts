export type PurchaseHorizonYears = 3 | 5 | 10;

export type PurchaseScoreBand = 'weak' | 'moderate' | 'strong' | 'very_strong';

export type FutureTrajectoryDirection =
  | 'strengthening'
  | 'stable'
  | 'uncertain'
  | 'declining'
  | 'high_risk';

export type PurchaseTrajectoryConfidence = 'low' | 'medium' | 'high';

export type PurchaseTerritoryType =
  | 'dense_urban_core'
  | 'mixed_city_residential'
  | 'family_residential'
  | 'premium_low_density_residential'
  | 'resort_or_leisure_residential'
  | 'suburban_commuter_zone'
  | 'weak_peripheral_residential'
  | 'industrial_or_road_risk_zone'
  | 'no_evidence_uncertain';

export type PurchaseEarlyWarningSignalType =
  | 'government_procurement_engineering_survey'
  | 'government_procurement_road_design'
  | 'government_procurement_school_design'
  | 'government_procurement_hospital_design'
  | 'government_procurement_interchange_design'
  | 'general_plan_or_land_use_rules'
  | 'territory_planning_project'
  | 'construction_permit'
  | 'cadastral_change'
  | 'new_residential_complex'
  | 'developer_activity'
  | 'transport_plan'
  | 'industrial_zone_reconstruction'
  | 'public_realm_improvement'
  | 'highway_or_major_road_risk'
  | 'industrial_zone_risk'
  | 'noise_risk'
  | 'overbuilding_risk'
  | 'weak_social_infrastructure'
  | 'stalled_construction';

export type PurchaseSignalImpact = 'positive' | 'negative' | 'mixed';
export type PurchaseSignalConfidence = 'low' | 'medium' | 'high';
export type PurchaseSignalStage =
  | 'early_hint'
  | 'planning'
  | 'design'
  | 'procurement'
  | 'permit'
  | 'construction'
  | 'active';

export type PurchaseSignalGeoPrecision =
  | 'exact_address'
  | 'nearby'
  | 'district'
  | 'city'
  | 'unknown';

export interface PurchaseEvidenceRef {
  label: string;
  sourceUrl?: string;
}

export interface PurchaseEarlyWarningSignal {
  type: PurchaseEarlyWarningSignalType;
  impact: PurchaseSignalImpact;
  confidence: PurchaseSignalConfidence;
  stage?: PurchaseSignalStage;
  geoPrecision?: PurchaseSignalGeoPrecision;
  horizonYears?: PurchaseHorizonYears;
  title?: string;
  evidence?: PurchaseEvidenceRef[];
}

export interface PurchaseTerritoryEvidence {
  density?: 'high' | 'medium' | 'low' | 'unknown';
  mixityScore?: number;
  housingQualityScore?: number;
  greenScore?: number;
  socialInfrastructureScore?: number;
  transportAccessScore?: number;
  safetyScore?: number;
  prestigeScore?: number;
  resortLeisureScore?: number;
  industrialRiskScore?: number;
  roadNoiseRiskScore?: number;
  peripheralIsolationScore?: number;
  overbuildingPressureScore?: number;
  strBusinessMagnetScore?: number;
  h3?: {
    countedMagnets?: number;
    categoryDiversityScore?: number;
    transportDominanceRatio?: number;
    deadZones?: {
      gapRatio?: number;
      emptyCellRatio?: number;
      lowDensityCellRatio?: number;
    };
    businessTravelerSuitability?: {
      score?: number;
      level?: 'weak' | 'moderate' | 'strong';
      hasBusinessCore?: boolean;
      hasTransportAccess?: boolean;
      transportOverDominated?: boolean;
    };
  };
  territorialSignals?: {
    signalQuality?: 'none' | 'low' | 'medium' | 'high';
    countedSignals?: number;
    diversity?: { value?: number };
    transportBalance?: { value?: number };
    deadZonePenalty?: { value?: number; gapRatio?: number };
    flags?: {
      hasTransportAccess?: boolean;
      lowSignal?: boolean;
      transportOverDominated?: boolean;
    };
  };
}

export interface PurchaseObjectEvidence {
  priceOverheatScore?: number;
  buildingQualityScore?: number;
  resaleDepthScore?: number;
  optionalRentalDemandScore?: number;
}

export interface ResidentialPurchaseScoreInput {
  territory?: PurchaseTerritoryEvidence;
  object?: PurchaseObjectEvidence;
  earlyWarningSignals?: PurchaseEarlyWarningSignal[];
  horizon?: PurchaseHorizonYears;
}

export interface PurchaseScoreDimensions {
  liquidityScore: number;
  livingQualityScore: number;
  infrastructureScore: number;
  transportScore: number;
  ecologyScore: number;
  prestigeLifestyleScore: number;
  futureUpsideScore: number;
  declineRiskScore: number;
  overbuildingRiskScore: number;
  riskPenalty: number;
  optionalRentalScore: number;
}

export interface PurchaseTerritoryClassification {
  type: PurchaseTerritoryType;
  confidence: PurchaseTrajectoryConfidence;
  reasons: string[];
}

export interface FutureTrajectoryEvidence {
  type: PurchaseEarlyWarningSignalType | 'current_purchase_score' | 'territory_risk';
  impact: PurchaseSignalImpact;
  confidence: PurchaseSignalConfidence;
  label: string;
}

export interface FutureTrajectoryScore {
  direction: FutureTrajectoryDirection;
  currentScore: number;
  futureUpsideScore: number;
  declineRiskScore: number;
  confidence: PurchaseTrajectoryConfidence;
  horizon: PurchaseHorizonYears;
  evidence: FutureTrajectoryEvidence[];
}

export interface ResidentialPurchaseExplanation {
  summaryRu: string;
  strengthsRu: string[];
  risksRu: string[];
  notesRu: string[];
}

export interface ResidentialPurchaseScore {
  version: 'residential-purchase-score-v1';
  territory: PurchaseTerritoryClassification;
  dimensions: PurchaseScoreDimensions;
  currentScore: number;
  finalScore: number;
  band: PurchaseScoreBand;
  trajectory: FutureTrajectoryScore;
  explanation: ResidentialPurchaseExplanation;
}
