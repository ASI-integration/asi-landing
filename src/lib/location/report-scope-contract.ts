import {
  getLocationReportScopeSectionIds,
  type FreeLocationReportScopeSectionId,
  type PaidLocationReportScopeSectionId,
} from './location-report-structure';

export type LocationReportScopeMode = 'free' | 'paid';

export type FreeLocationReportSectionId = FreeLocationReportScopeSectionId;

export type PaidLocationReportSectionId = PaidLocationReportScopeSectionId;

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

export const freeReportSections =
  getLocationReportScopeSectionIds('free') as readonly FreeLocationReportSectionId[];

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

export const paidReportSections =
  getLocationReportScopeSectionIds('paid') as readonly PaidLocationReportSectionId[];

export const commercialFootTrafficPlannedSection = {
  id: 'commercialFootTraffic',
  status: 'planned_placeholder',
  dataSourceKey: 'commercial_foot_traffic',
  connectedSectionStatus: 'allowed',
  note:
    'Reserved for commercial foot traffic once a dedicated data source is connected. Until then it must stay a planned placeholder, not an analytical claim.',
} as const satisfies PlannedLocationReportSection;

export const freePdfSections = freeReportSections;

export const paidPdfSections = paidReportSections;

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
