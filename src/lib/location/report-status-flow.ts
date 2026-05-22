import {
  LOCATION_REPORT_SAMPLE_PATH,
  LOCATION_REPORT_SAMPLE_PDF_PATH,
  LOCATION_REPORT_STATUS_PATH,
} from './report-state';
import {
  REPORT_ARTIFACT_STATUS,
  type ReportArtifact,
  type ReportArtifactStatus,
} from './report-artifact';

export const LOCATION_REPORT_STATUS_STAGE_SEQUENCE = [
  REPORT_ARTIFACT_STATUS.reportForming,
  REPORT_ARTIFACT_STATUS.preliminaryReady,
  REPORT_ARTIFACT_STATUS.finalReady,
  REPORT_ARTIFACT_STATUS.pdfReady,
] as const;

export type LocationReportStatusStage = typeof LOCATION_REPORT_STATUS_STAGE_SEQUENCE[number];

export type LocationReportStatusStageConfig = {
  label: string;
  detail: string;
};

export type LocationReportStatusAction = {
  id: 'preliminary_report' | 'final_report' | 'pdf_report';
  label: string;
  href: keyof Pick<ReportArtifact, 'preliminary_report_url' | 'final_report_url' | 'pdf_url'>;
  fallbackHref: string;
  availableFrom: LocationReportStatusStage;
  tone: 'secondary' | 'primary';
};

export const LOCATION_REPORT_STATUS_INITIAL_STAGE: LocationReportStatusStage = REPORT_ARTIFACT_STATUS.reportForming;
export const LOCATION_REPORT_ARTIFACT_INITIAL_STATUS: ReportArtifactStatus = REPORT_ARTIFACT_STATUS.reportForming;

export const LOCATION_REPORT_STATUS_STAGE_CONFIG: Record<LocationReportStatusStage, LocationReportStatusStageConfig> = {
  [REPORT_ARTIFACT_STATUS.reportForming]: {
    label: 'Отчёт формируется',
    detail: 'Собираем данные и готовим разделы отчёта.',
  },
  [REPORT_ARTIFACT_STATUS.preliminaryReady]: {
    label: 'Предварительная версия готова',
    detail: 'Можно открыть первую версию и проверить основные выводы.',
  },
  [REPORT_ARTIFACT_STATUS.finalReady]: {
    label: 'Полная веб-версия готова',
    detail: 'Полная веб-версия отчёта доступна по ссылке.',
  },
  [REPORT_ARTIFACT_STATUS.pdfReady]: {
    label: 'PDF готов',
    detail: 'PDF можно открыть или скачать. Ссылка появится в личном кабинете и придёт на e-mail.',
  },
};

export const LOCATION_REPORT_STATUS_DELIVERY_HINT =
  'Ссылка появится в личном кабинете и придёт на e-mail.';

export const LOCATION_REPORT_STATUS_ACTIONS: readonly LocationReportStatusAction[] = [
  {
    id: 'preliminary_report',
    label: 'Открыть предварительный отчёт',
    href: 'preliminary_report_url',
    fallbackHref: `${LOCATION_REPORT_SAMPLE_PATH}?view=preliminary`,
    availableFrom: REPORT_ARTIFACT_STATUS.preliminaryReady,
    tone: 'secondary',
  },
  {
    id: 'final_report',
    label: 'Открыть финальный отчёт',
    href: 'final_report_url',
    fallbackHref: LOCATION_REPORT_SAMPLE_PATH,
    availableFrom: REPORT_ARTIFACT_STATUS.finalReady,
    tone: 'secondary',
  },
  {
    id: 'pdf_report',
    label: 'Открыть PDF',
    href: 'pdf_url',
    fallbackHref: LOCATION_REPORT_SAMPLE_PDF_PATH,
    availableFrom: REPORT_ARTIFACT_STATUS.pdfReady,
    tone: 'primary',
  },
];

export function isLocationReportStatusStage(value: unknown): value is LocationReportStatusStage {
  return typeof value === 'string' && LOCATION_REPORT_STATUS_STAGE_SEQUENCE.includes(value as LocationReportStatusStage);
}

export function normalizeLocationReportStatusStage(value: unknown): LocationReportStatusStage {
  return isLocationReportStatusStage(value) ? value : LOCATION_REPORT_STATUS_INITIAL_STAGE;
}

export function getLocationReportStatusStageIndex(stage: LocationReportStatusStage): number {
  return LOCATION_REPORT_STATUS_STAGE_SEQUENCE.indexOf(stage);
}

export function hasLocationReportStatusReached(
  current: ReportArtifactStatus,
  target: LocationReportStatusStage,
): boolean {
  if (!isLocationReportStatusStage(current)) return false;
  return getLocationReportStatusStageIndex(current) >= getLocationReportStatusStageIndex(target);
}

export function getNextLocationReportStatusStage(
  current: LocationReportStatusStage,
): LocationReportStatusStage | null {
  const next = LOCATION_REPORT_STATUS_STAGE_SEQUENCE[getLocationReportStatusStageIndex(current) + 1];
  return next ?? null;
}

export function buildLocationReportStatusHref(
  stage: LocationReportStatusStage = LOCATION_REPORT_STATUS_INITIAL_STAGE,
  requestId?: string,
): string {
  const params = new URLSearchParams();
  if (requestId) params.set('requestId', requestId);
  else params.set('stage', stage);
  return `${LOCATION_REPORT_STATUS_PATH}?${params.toString()}`;
}
