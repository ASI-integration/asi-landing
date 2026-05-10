import type { UrbanDevelopmentAdapter, UrbanDevelopmentCollectInput, UrbanDevelopmentSignal } from '../urban-development';
import { classifyPublicProcurementNotice } from './classify-notice';
import type { PublicProcurementFixtureFile } from './fixture-types';
import { parsePublicProcurementFixtureFile } from './fixture-types';
import sampleNoticesFixture from './fixtures/sample-notices.json';

function regionMatchesFixture(regionOrCity: string, regionHint?: string): boolean {
  const r = regionOrCity.trim().toLowerCase();
  if (!r) return true;
  const h = regionHint?.trim().toLowerCase();
  if (!h) return true;
  return r.includes(h) || h.includes(r);
}

function noticeToSignal(
  notice: PublicProcurementFixtureFile['notices'][number],
  input: UrbanDevelopmentCollectInput,
): UrbanDevelopmentSignal {
  const classified = classifyPublicProcurementNotice(notice);

  const summaryParts = [
    input.locale === 'en'
      ? 'Fixture procurement notice mapped to an urban-development signal.'
      : 'Тестовая закупочная позиция, преобразованная в сигнал городского развития.',
    notice.customer ? `${input.locale === 'en' ? 'Customer' : 'Заказчик'}: ${notice.customer}` : undefined,
    notice.procedureStage
      ? `${input.locale === 'en' ? 'Procedure stage' : 'Этап процедуры'}: ${notice.procedureStage}`
      : undefined,
  ].filter(Boolean);

  const limitations =
    input.locale === 'en'
      ? ['Fixture-only ingestion; no live госзакупки source was queried.']
      : ['Загрузка только из фикстуры; живой источник госзакупок не запрашивался.'];

  return {
    kind: 'publicProcurement',
    signalType: classified.signalType,
    title: notice.title,
    summary: summaryParts.join(' '),
    locationReference: notice.regionHint,
    status: classified.status,
    confidence: classified.confidence,
    lifecycleStage: classified.lifecycleStage,
    sourceUrl: notice.url,
    sourceDate: notice.publishedAt,
    evidence: [
      {
        label: input.locale === 'en' ? 'Procurement id' : 'Идентификатор закупки',
        detail: notice.id,
      },
      ...(classified.thematicMatched
        ? [
            {
              label: input.locale === 'en' ? 'Classifier' : 'Классификатор',
              detail:
                input.locale === 'en'
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

export interface PublicProcurementFixtureAdapterOptions {
  readonly fixture: unknown;
  readonly id?: string;
  readonly label?: string;
  readonly enabled?: boolean;
}

/**
 * Fixture/sample-backed adapter: parses a JSON-shaped payload (e.g. imported fixture file)
 * into {@link UrbanDevelopmentSignal} rows. Swap `fixture` for API responses later without changing classification.
 */
export function createPublicProcurementFixtureAdapter(options: PublicProcurementFixtureAdapterOptions): UrbanDevelopmentAdapter {
  const parsed = parsePublicProcurementFixtureFile(options.fixture);

  return {
    id: options.id ?? 'publicProcurement.fixture.sample',
    kind: 'publicProcurement',
    enabled: options.enabled ?? true,
    label: options.label ?? 'Public procurement (fixture sample)',
    collect: async (input: UrbanDevelopmentCollectInput) => {
      const out: UrbanDevelopmentSignal[] = [];
      for (const notice of parsed.notices) {
        if (!regionMatchesFixture(input.regionOrCity, notice.regionHint)) continue;
        out.push(noticeToSignal(notice, input));
      }
      return out;
    },
  };
}

/** Bundled sample notices for offline tests and demos (no network I/O). */
export function createDefaultSamplePublicProcurementFixtureAdapter(): UrbanDevelopmentAdapter {
  return createPublicProcurementFixtureAdapter({
    fixture: sampleNoticesFixture as unknown,
    id: 'publicProcurement.fixture.sampleNotices',
    label: 'Public procurement (bundled sample notices)',
  });
}

export type { PublicProcurementFixtureFile };
