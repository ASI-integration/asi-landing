export type LocationReportScopeMode = 'free' | 'paid';

export type FreeLocationReportSectionId =
  | 'addressAndCalculatedAt'
  | 'publicScore'
  | 'shortVerdict'
  | 'topEvidenceBullets'
  | 'shortRecommendation'
  | 'paidReportTeaser'
  | 'CTA';

export type PaidLocationReportSectionId =
  | 'executiveSummary'
  | 'fullScoreExplanation'
  | 'magnetsByCategory'
  | 'transport'
  | 'medical'
  | 'business'
  | 'education'
  | 'retailAndEvents'
  | 'competitors'
  | 'risks'
  | 'targetAudiences'
  | 'strategy'
  | 'urbanDevelopmentForecast'
  | 'dataFreshness'
  | 'sourceEvidence'
  | 'finalRecommendation';

export type PlannedLocationReportSectionId = 'commercialFootTraffic';

export type FreeLocationReportForbiddenField =
  | 'internalWeights'
  | 'formulas'
  | 'debugTrace'
  | 'fullMagnetList'
  | 'competitorDetails'
  | 'revenueScenarios'
  | 'fullUrbanDevelopmentRadar'
  | 'rawSources'
  | 'exactScoringInternals'
  | 'scoringWeights'
  | 'scoringFormula'
  | 'scoreTrace'
  | 'kernelTrace';

export type ReportScopeSectionStatus =
  | 'allowed'
  | 'forbidden'
  | 'planned_placeholder'
  | 'requires_connected_source';

export interface PlannedLocationReportSection {
  id: PlannedLocationReportSectionId;
  status: Extract<ReportScopeSectionStatus, 'planned_placeholder' | 'requires_connected_source'>;
  dataSourceKey: string;
  connectedSectionStatus: Extract<ReportScopeSectionStatus, 'allowed'>;
  note: string;
}

export const FREE_TOP_EVIDENCE_BULLETS_LIMIT = {
  min: 3,
  max: 5,
} as const;

export const freeReportSections = [
  'addressAndCalculatedAt',
  'publicScore',
  'shortVerdict',
  'topEvidenceBullets',
  'shortRecommendation',
  'paidReportTeaser',
  'CTA',
] as const satisfies readonly FreeLocationReportSectionId[];

export const forbiddenFreeReportFields = [
  'internalWeights',
  'formulas',
  'debugTrace',
  'fullMagnetList',
  'competitorDetails',
  'revenueScenarios',
  'fullUrbanDevelopmentRadar',
  'rawSources',
  'exactScoringInternals',
  'scoringWeights',
  'scoringFormula',
  'scoreTrace',
  'kernelTrace',
] as const satisfies readonly FreeLocationReportForbiddenField[];

export const paidReportSections = [
  'executiveSummary',
  'fullScoreExplanation',
  'magnetsByCategory',
  'transport',
  'medical',
  'business',
  'education',
  'retailAndEvents',
  'competitors',
  'risks',
  'targetAudiences',
  'strategy',
  'urbanDevelopmentForecast',
  'dataFreshness',
  'sourceEvidence',
  'finalRecommendation',
] as const satisfies readonly PaidLocationReportSectionId[];

export const commercialFootTrafficPlannedSection = {
  id: 'commercialFootTraffic',
  status: 'planned_placeholder',
  dataSourceKey: 'commercial_foot_traffic',
  connectedSectionStatus: 'allowed',
  note:
    'Reserved for commercial foot traffic once a dedicated data source is connected. Until then it must stay a planned placeholder, not an analytical claim.',
} as const satisfies PlannedLocationReportSection;

export const freePdfSections = [
  'addressAndCalculatedAt',
  'publicScore',
  'shortVerdict',
  'topEvidenceBullets',
  'shortRecommendation',
  'paidReportTeaser',
  'CTA',
] as const satisfies readonly FreeLocationReportSectionId[];

export const paidPdfSections = [
  'executiveSummary',
  'fullScoreExplanation',
  'magnetsByCategory',
  'transport',
  'medical',
  'business',
  'education',
  'retailAndEvents',
  'competitors',
  'risks',
  'targetAudiences',
  'strategy',
  'urbanDevelopmentForecast',
  'dataFreshness',
  'sourceEvidence',
  'finalRecommendation',
] as const satisfies readonly PaidLocationReportSectionId[];

export const locationReportScopeContract = {
  version: 'location-report-scope-contract-v1',
  modes: {
    free: {
      mode: 'free',
      allowedSections: freeReportSections,
      forbiddenFields: forbiddenFreeReportFields,
      limits: {
        topEvidenceBullets: FREE_TOP_EVIDENCE_BULLETS_LIMIT,
      },
      pdfSections: freePdfSections,
    },
    paid: {
      mode: 'paid',
      allowedSections: paidReportSections,
      plannedSections: [commercialFootTrafficPlannedSection],
      pdfSections: paidPdfSections,
    },
  },
} as const;

const freeSectionSet = new Set<string>(freeReportSections);
const forbiddenFreeFieldSet = new Set<string>(forbiddenFreeReportFields);

export function isFreeReportSectionAllowed(sectionId: string): sectionId is FreeLocationReportSectionId {
  return freeSectionSet.has(sectionId);
}

export function isFreeReportFieldForbidden(fieldId: string): fieldId is FreeLocationReportForbiddenField {
  return forbiddenFreeFieldSet.has(fieldId);
}

export function resolveCommercialFootTrafficSectionStatus(args: {
  commercialFootTrafficSourceConnected: boolean;
}): ReportScopeSectionStatus {
  return args.commercialFootTrafficSourceConnected
    ? commercialFootTrafficPlannedSection.connectedSectionStatus
    : commercialFootTrafficPlannedSection.status;
}
