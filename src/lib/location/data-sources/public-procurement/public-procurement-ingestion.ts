import type { UrbanDevelopmentCollectInput, UrbanDevelopmentSignal } from '../urban-development';
import type { ClassifiedPublicProcurementUrbanSignal, PublicProcurementNoticeInput } from './classify-notice';
import { classifyPublicProcurementNotice } from './classify-notice';
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

export interface PublicProcurementIngestionPipelineResult {
  readonly signal: UrbanDevelopmentSignal;
}

/**
 * Structural validation / normalization stage for a single upstream JSON object.
 * Reuses fixture validation rules so dictionaries/classifiers remain the single behavioral source.
 */
export function validatePublicProcurementRawNoticePayload(payload: unknown): ProcurementNoticeWorkUnit {
  const parsed = parsePublicProcurementNoticeRecord(payload, 0);
  return { validated: parsed.validated, rawPayload: parsed.rawPayload };
}

function provenanceFromValidated(validated: PublicProcurementNoticeInput, sourceName: string): UrbanDevelopmentSignal['sourceProvenance'] {
  return {
    sourceName,
    sourceUrl: validated.url,
    externalId: validated.id,
    publishedAt: validated.publishedAt,
    updatedAt: validated.updatedAt,
    region: validated.regionHint,
  };
}

function signalFromClassified(
  validated: PublicProcurementNoticeInput,
  classified: ClassifiedPublicProcurementUrbanSignal,
  ctx: PublicProcurementIngestionContext,
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
    locationReference: validated.regionHint,
    status: classified.status,
    confidence: classified.confidence,
    lifecycleStage: classified.lifecycleStage,
    sourceUrl: validated.url,
    sourceDate: validated.publishedAt,
    sourceProvenance: provenanceFromValidated(validated, ctx.sourceName),
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
): UrbanDevelopmentSignal {
  return signalFromClassified(validated, classified, ctx);
}

export function runPublicProcurementIngestionPipeline(
  unit: ProcurementNoticeWorkUnit,
  ctx: PublicProcurementIngestionContext,
): PublicProcurementIngestionPipelineResult {
  const classified = classifyValidatedProcurementNotice(unit.validated);
  const signal = normalizedUrbanSignalFromProcurementPipeline(unit.validated, classified, ctx);
  return { signal };
}
