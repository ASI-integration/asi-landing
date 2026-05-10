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

/** Top-level urban-development source categories (adapter boundaries). */
export type UrbanDevelopmentSourceKind =
  | 'masterPlan'
  | 'zoningRules'
  | 'planningProjects'
  | 'integratedDevelopment'
  | 'publicHearings'
  | 'publicProcurement'
  | 'landAuctions'
  | 'infrastructurePlans';

export type UrbanDevelopmentSignalType =
  | 'general_plan'
  | 'strategic_development_plan'
  | 'zoning_code'
  | 'land_use_rule'
  | 'zoning_change'
  | 'planning_territory'
  | 'survey_boundary'
  | 'red_line'
  | 'street_grid_plan'
  | 'infrastructure_plan_doc'
  | 'krt'
  | 'integrated_territory_development'
  | 'public_hearing'
  | 'public_objection'
  | 'approval_signal'
  | 'government_procurement'
  | 'engineering_survey'
  | 'design_documentation'
  | 'planning_contract'
  | 'land_auction'
  | 'lease_auction'
  | 'development_rights_auction'
  | 'road_project'
  | 'transport_hub'
  | 'transit_change'
  | 'social_infrastructure'
  | 'unknown';

export type UrbanDevelopmentSignalStatus =
  | 'planned'
  | 'discussed'
  | 'approved'
  | 'in_design'
  | 'procurement'
  | 'unknown';

export interface UrbanDevelopmentTimeHorizon {
  label: string;
  startYear?: number;
  endYear?: number;
}

export type UrbanDevelopmentConfidence = ConfidenceLevel;

/** Procurement/planning maturity hint derived from notice text and procedure metadata (not calendar dates). */
export type UrbanDevelopmentLifecycleStage =
  | 'planning'
  | 'design'
  | 'procurement'
  | 'construction_preparation';

export interface UrbanDevelopmentEvidence {
  label: string;
  detail?: string;
  reference?: string;
}

export interface UrbanDevelopmentManualCheck {
  reason: string;
  hint?: string;
}

export interface UrbanDevelopmentGeoPoint {
  lat: number;
  lon: number;
}

export interface UrbanDevelopmentBoundingBox {
  minLat: number;
  minLon: number;
  maxLat: number;
  maxLon: number;
}

/** Traceability for procurement-derived signals; excludes raw upstream payloads. */
export interface UrbanDevelopmentSignalSourceProvenance {
  sourceName: string;
  sourceUrl?: string;
  externalId?: string;
  publishedAt?: string;
  updatedAt?: string;
  region?: string;
}

export interface UrbanDevelopmentSignal {
  kind: UrbanDevelopmentSourceKind;
  signalType: UrbanDevelopmentSignalType;
  title: string;
  summary: string;
  locationReference?: string;
  coordinates?: UrbanDevelopmentGeoPoint;
  boundingBox?: UrbanDevelopmentBoundingBox;
  timeHorizon?: UrbanDevelopmentTimeHorizon;
  status: UrbanDevelopmentSignalStatus;
  confidence: UrbanDevelopmentConfidence;
  lifecycleStage?: UrbanDevelopmentLifecycleStage;
  sourceUrl?: string;
  sourceDate?: string;
  /** Procurement/source catalog identity — normalized signal stays free of raw upstream blobs. */
  sourceProvenance?: UrbanDevelopmentSignalSourceProvenance;
  evidence: UrbanDevelopmentEvidence[];
  limitations: string[];
  manualVerificationNeeded: boolean;
  manualChecks?: UrbanDevelopmentManualCheck[];
}

export interface UrbanDevelopmentCollectInput {
  regionOrCity: string;
  coordinates?: UrbanDevelopmentGeoPoint;
  locale?: 'ru' | 'en';
}

export interface UrbanDevelopmentAdapter {
  readonly id: string;
  readonly kind: UrbanDevelopmentSourceKind;
  readonly enabled: boolean;
  readonly label: string;
  collect(input: UrbanDevelopmentCollectInput): Promise<UrbanDevelopmentSignal[]>;
}

export type MasterPlanUrbanDevelopmentAdapter = UrbanDevelopmentAdapter & { readonly kind: 'masterPlan' };
export type ZoningRulesUrbanDevelopmentAdapter = UrbanDevelopmentAdapter & { readonly kind: 'zoningRules' };
export type PlanningProjectsUrbanDevelopmentAdapter = UrbanDevelopmentAdapter & { readonly kind: 'planningProjects' };
export type IntegratedDevelopmentUrbanDevelopmentAdapter = UrbanDevelopmentAdapter & {
  readonly kind: 'integratedDevelopment';
};
export type PublicHearingsUrbanDevelopmentAdapter = UrbanDevelopmentAdapter & { readonly kind: 'publicHearings' };
export type PublicProcurementUrbanDevelopmentAdapter = UrbanDevelopmentAdapter & {
  readonly kind: 'publicProcurement';
};
export type LandAuctionsUrbanDevelopmentAdapter = UrbanDevelopmentAdapter & { readonly kind: 'landAuctions' };
export type InfrastructurePlansUrbanDevelopmentAdapter = UrbanDevelopmentAdapter & {
  readonly kind: 'infrastructurePlans';
};

export type UrbanDevelopmentCollectionStatus = 'not_configured' | 'collected';

export interface UrbanDevelopmentCollectionResult {
  status: UrbanDevelopmentCollectionStatus;
  signals: UrbanDevelopmentSignal[];
  limitations: string[];
  manualVerificationNeeded: boolean;
}

export type UrbanDevelopmentSignalInput = Partial<Omit<UrbanDevelopmentSignal, 'kind' | 'title' | 'summary'>> & {
  kind: UrbanDevelopmentSourceKind;
  title: string;
  summary: string;
};

const ADAPTER_NOT_CONNECTED =
  'Urban development source adapters are not connected yet.' as const;

export function getUrbanDevelopmentAdapters(_regionOrCity: string): UrbanDevelopmentAdapter[] {
  return [];
}

function emptyCollectionResult(): UrbanDevelopmentCollectionResult {
  return {
    status: 'not_configured',
    signals: [],
    limitations: [ADAPTER_NOT_CONNECTED],
    manualVerificationNeeded: true,
  };
}

export function normalizeUrbanDevelopmentSignals(rawSignals: UrbanDevelopmentSignalInput[]): UrbanDevelopmentSignal[] {
  return rawSignals.map(raw => {
    const signalType = raw.signalType ?? 'unknown';
    const status = raw.status ?? 'unknown';
    const confidence = raw.confidence ?? 'low';
    const evidence = raw.evidence ?? [];
    const limitations = raw.limitations ?? [];
    const hasUrl = Boolean(raw.sourceUrl?.trim());
    const manualVerificationNeeded =
      raw.manualVerificationNeeded === true
      || confidence === 'low'
      || !hasUrl;

    return {
      kind: raw.kind,
      signalType,
      title: raw.title,
      summary: raw.summary,
      locationReference: raw.locationReference,
      coordinates: raw.coordinates,
      boundingBox: raw.boundingBox,
      timeHorizon: raw.timeHorizon,
      status,
      confidence,
      lifecycleStage: raw.lifecycleStage,
      sourceUrl: raw.sourceUrl?.trim() || undefined,
      sourceDate: raw.sourceDate,
      sourceProvenance: raw.sourceProvenance,
      evidence,
      limitations,
      manualVerificationNeeded,
      manualChecks: raw.manualChecks,
    };
  });
}

export async function collectUrbanDevelopmentSignals(
  _input: UrbanDevelopmentCollectInput,
  adapters: UrbanDevelopmentAdapter[],
): Promise<UrbanDevelopmentCollectionResult> {
  const active = adapters.filter(a => a.enabled);
  if (active.length === 0) {
    return emptyCollectionResult();
  }

  const chunks = await Promise.all(active.map(a => a.collect(_input)));
  const merged = chunks.flat();
  const normalized = normalizeUrbanDevelopmentSignals(merged);

  return {
    status: 'collected',
    signals: normalized,
    limitations: normalized.flatMap(s => s.limitations),
    manualVerificationNeeded: normalized.some(s => s.manualVerificationNeeded),
  };
}

function legacySourceTypeForKind(kind: UrbanDevelopmentSourceKind): UrbanDevelopmentSourceType {
  switch (kind) {
    case 'publicProcurement':
    case 'landAuctions':
      return 'open_city_development_source';
    case 'infrastructurePlans':
      return 'planned_infrastructure';
    case 'masterPlan':
    case 'zoningRules':
    case 'planningProjects':
    case 'integratedDevelopment':
    case 'publicHearings':
      return 'public_urban_planning_data';
  }
}

function constructionCategoryFromSignal(s: UrbanDevelopmentSignal): PlannedConstructionProject['category'] {
  const t = s.signalType;
  if (t === 'land_auction' || t === 'lease_auction' || t === 'development_rights_auction') return 'unknown';
  if (t === 'krt' || t === 'integrated_territory_development' || t === 'planning_territory') return 'mixed_use';
  return 'unknown';
}

function infraKindFromSignalType(t: UrbanDevelopmentSignalType): PlannedInfrastructureChange['kind'] {
  if (t === 'road_project') return 'road';
  if (t === 'transport_hub' || t === 'transit_change') return 'public_transport';
  if (t === 'social_infrastructure') return 'utility';
  return 'unknown';
}

function isRoadTransportSignal(s: UrbanDevelopmentSignal): boolean {
  return (
    s.kind === 'infrastructurePlans'
    && (s.signalType === 'road_project' || s.signalType === 'transport_hub' || s.signalType === 'transit_change')
  );
}

function signalToSourceReference(s: UrbanDevelopmentSignal): UrbanDevelopmentSourceReference {
  return {
    sourceType: legacySourceTypeForKind(s.kind),
    title: s.title,
    url: s.sourceUrl,
    retrievedAtIso: s.sourceDate,
    note: s.summary,
  };
}

function evidenceLines(s: UrbanDevelopmentSignal): string[] {
  const fromEvidence = s.evidence.map(e =>
    e.detail ? `${e.label}: ${e.detail}` : e.label,
  );
  const stageLine = s.lifecycleStage ? [`Lifecycle stage: ${s.lifecycleStage}`] : [];
  return [...stageLine, ...fromEvidence, ...s.limitations];
}

function pushUniqueSource(acc: UrbanDevelopmentSourceReference[], ref: UrbanDevelopmentSourceReference): void {
  const key = `${ref.url ?? ''}|${ref.title}|${ref.sourceType}`;
  if (!acc.some(x => `${x.url ?? ''}|${x.title}|${x.sourceType}` === key)) {
    acc.push(ref);
  }
}

/**
 * Maps normalized adapter-layer signals into the snapshot shape consumed by the unified location report.
 */
export function urbanDevelopmentSnapshotFromSignals(signals: UrbanDevelopmentSignal[]): UrbanDevelopmentSignalsSnapshot {
  const plannedConstructionProjects: PlannedConstructionProject[] = [];
  const infrastructurePlans: PlannedInfrastructureChange[] = [];
  const roadTransportChanges: PlannedInfrastructureChange[] = [];
  const zoningPublicPlanningNotes: ZoningPlanningNote[] = [];
  const sources: UrbanDevelopmentSourceReference[] = [];

  for (const s of signals) {
    const ref = signalToSourceReference(s);
    pushUniqueSource(sources, ref);
    const reliability = s.confidence;
    const notes = evidenceLines(s);

    if (
      s.kind === 'masterPlan'
      || s.kind === 'planningProjects'
      || s.kind === 'integratedDevelopment'
      || s.kind === 'publicProcurement'
      || s.kind === 'landAuctions'
      || s.kind === 'publicHearings'
    ) {
      plannedConstructionProjects.push({
        title: s.title,
        category: constructionCategoryFromSignal(s),
        expectedTimeHorizon: s.timeHorizon?.label,
        source: ref,
        confidence: s.confidence,
        sourceReliability: reliability,
        notes,
      });
      continue;
    }

    if (s.kind === 'zoningRules') {
      zoningPublicPlanningNotes.push({
        title: s.title,
        zoningType: s.signalType === 'zoning_code' ? 'ПЗЗ' : s.signalType === 'land_use_rule' ? 'land_use' : undefined,
        source: ref,
        confidence: s.confidence,
        sourceReliability: reliability,
        notes,
      });
      continue;
    }

    if (s.kind === 'infrastructurePlans') {
      const row: PlannedInfrastructureChange = {
        title: s.title,
        kind: infraKindFromSignalType(s.signalType),
        expectedTimeHorizon: s.timeHorizon?.label,
        source: ref,
        confidence: s.confidence,
        sourceReliability: reliability,
        potentialImpact: 'unknown',
        notes,
      };
      if (isRoadTransportSignal(s)) {
        roadTransportChanges.push(row);
      }
      else {
        infrastructurePlans.push(row);
      }
    }
  }

  return {
    plannedConstructionProjects,
    infrastructurePlans,
    roadTransportChanges,
    zoningPublicPlanningNotes,
    sources,
  };
}
