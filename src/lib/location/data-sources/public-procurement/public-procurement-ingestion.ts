import type { UrbanDevelopmentCollectInput, UrbanDevelopmentSignal } from '../urban-development';
import type { ClassifiedPublicProcurementUrbanSignal, PublicProcurementNoticeInput } from './classify-notice';
import { classifyPublicProcurementNotice } from './classify-notice';
import type { ProcurementGeoExtracted, ProcurementGeoExtractionResult } from './extract-public-procurement-geo';
import { composeProcurementLocationReference, extractPublicProcurementGeo } from './extract-public-procurement-geo';
import type { ProcurementGeoSignalQualityAssessment } from './procurement-geo-signal-quality';
import { assessProcurementGeoSignalQuality } from './procurement-geo-signal-quality';
import { parsePublicProcurementNoticeRecord } from './fixture-types';

/** Work unit after structural validation — `rawPayload` is audit-only and stays off signals. */
export interface ProcurementNoticeWorkUnit {
  readonly validated: PublicProcurementNoticeInput;
  readonly rawPayload: unknown;
}

export interface PublicProcurementIngestionContext {
  readonly locale?: UrbanDevelopmentCollectInput['locale'];
  readonly sourceName: string;
}

/** Audit-only слой пайплайна: сырые цитаты и промежуточные извлечения не попадают на {@link UrbanDevelopmentSignal}. */
export interface PublicProcurementIngestionAudit {
  readonly geoExtraction: ProcurementGeoExtractionResult;
  readonly geoSignalQuality: ProcurementGeoSignalQualityAssessment;
}

export interface PublicProcurementIngestionPipelineResult {
  readonly signal: UrbanDevelopmentSignal;
  readonly audit: PublicProcurementIngestionAudit;
}

/**
 * Structural validation / normalization stage for a single upstream JSON object.
 * Reuses fixture validation rules so dictionaries/classifiers remain the single behavioral source.
 */
export function validatePublicProcurementRawNoticePayload(payload: unknown): ProcurementNoticeWorkUnit {
  const parsed = parsePublicProcurementNoticeRecord(payload, 0);
  return { validated: parsed.validated, rawPayload: parsed.rawPayload };
}

function provenanceFromValidated(
  validated: PublicProcurementNoticeInput,
  sourceName: string,
  geo: ProcurementGeoExtracted,
): UrbanDevelopmentSignal['sourceProvenance'] {
  return {
    sourceName,
    sourceUrl: validated.url,
    externalId: validated.id,
    publishedAt: validated.publishedAt,
    updatedAt: validated.updatedAt,
    region: geo.region ?? validated.regionHint ?? geo.city,
  };
}

function signalFromClassified(
  validated: PublicProcurementNoticeInput,
  classified: ClassifiedPublicProcurementUrbanSignal,
  ctx: PublicProcurementIngestionContext,
  geoExtracted: ProcurementGeoExtracted,
  geoQuality: ProcurementGeoSignalQualityAssessment,
): UrbanDevelopmentSignal {
  const summaryParts = [
    ctx.locale === 'en'
      ? 'Fixture procurement notice mapped to an urban-development signal.'
      : 'Тестовая закупочная позиция, преобразованная в сигнал городского развития.',
    validated.customer ? `${ctx.locale === 'en' ? 'Customer' : 'Заказчик'}: ${validated.customer}` : undefined,
    validated.procedureStage
      ? `${ctx.locale === 'en' ? 'Procedure stage' : 'Этап процедуры'}: ${validated.procedureStage}`
      : undefined,
  ].filter(Boolean);

  const limitations =
    ctx.locale === 'en'
      ? ['Fixture-only ingestion; no live госзакупки source was queried.']
      : ['Загрузка только из фикстуры; живой источник госзакупок не запрашивался.'];

  return {
    kind: 'publicProcurement',
    signalType: classified.signalType,
    title: validated.title,
    summary: summaryParts.join(' '),
    locationReference: composeProcurementLocationReference(geoExtracted) ?? validated.regionHint,
    geoPrecision: geoQuality.geoPrecision,
    geoSignalConfidence: geoQuality.confidence,
    status: classified.status,
    confidence: classified.confidence,
    lifecycleStage: classified.lifecycleStage,
    sourceUrl: validated.url,
    sourceDate: validated.publishedAt,
    sourceProvenance: provenanceFromValidated(validated, ctx.sourceName, geoExtracted),
    evidence: [
      {
        label: ctx.locale === 'en' ? 'Procurement id' : 'Идентификатор закупки',
        detail: validated.id,
      },
      ...(classified.thematicMatched
        ? [
            {
              label: ctx.locale === 'en' ? 'Classifier' : 'Классификатор',
              detail:
                ctx.locale === 'en'
                  ? 'Matched public procurement urban thematic dictionary.'
                  : 'Сопоставление с тематическим словарём городских закупочных сигналов.',
            },
          ]
        : []),
    ],
    limitations,
    manualVerificationNeeded: false,
  };
}

/** Извлечение географии после валидации структуры и до классификации тематики. */
export function extractGeoFromValidatedProcurementNotice(
  validated: PublicProcurementNoticeInput,
): ProcurementGeoExtractionResult {
  return extractPublicProcurementGeo(validated);
}

/** Classification stage: dictionary-backed urban signal typing (unchanged rules). */
export function classifyValidatedProcurementNotice(
  validated: PublicProcurementNoticeInput,
): ClassifiedPublicProcurementUrbanSignal {
  return classifyPublicProcurementNotice(validated);
}

/** Terminal normalization into adapter-layer urban-development rows (no raw payload). */
export function normalizedUrbanSignalFromProcurementPipeline(
  validated: PublicProcurementNoticeInput,
  classified: ClassifiedPublicProcurementUrbanSignal,
  ctx: PublicProcurementIngestionContext,
  geoExtracted: ProcurementGeoExtracted,
  geoQuality: ProcurementGeoSignalQualityAssessment,
): UrbanDevelopmentSignal {
  return signalFromClassified(validated, classified, ctx, geoExtracted, geoQuality);
}

export function runPublicProcurementIngestionPipeline(
  unit: ProcurementNoticeWorkUnit,
  ctx: PublicProcurementIngestionContext,
): PublicProcurementIngestionPipelineResult {
  const geoExtraction = extractGeoFromValidatedProcurementNotice(unit.validated);
  const geoSignalQuality = assessProcurementGeoSignalQuality(geoExtraction.extracted);
  const classified = classifyValidatedProcurementNotice(unit.validated);
  const signal = normalizedUrbanSignalFromProcurementPipeline(
    unit.validated,
    classified,
    ctx,
    geoExtraction.extracted,
    geoSignalQuality,
  );
  return { signal, audit: { geoExtraction, geoSignalQuality } };
}
