import type { ConfidenceLevel } from '../../report-contract';
import type { UrbanDevelopmentGeoSignalPrecision } from '../urban-development';
import type { ProcurementGeoExtracted } from './extract-public-procurement-geo';

export interface ProcurementGeoSignalQualityAssessment {
  readonly geoPrecision: UrbanDevelopmentGeoSignalPrecision;
  readonly confidence: ConfidenceLevel;
  /** Пояснение для audit/work unit; на сигнал не выносится. */
  readonly reasonRu: string;
}

/** Совпадает с маркерами уличного адреса в {@link extract-public-procurement-geo.ts} (без изменения извлечения). */
const STRUCTURED_STREET_ADDRESS_RE =
  /((?:ул\.|улица|просп\.|проспект|ш\.|шоссе|набережная|пер\.|переулок)\s*[А-Яа-яёA-Za-z0-9\s\-\.]+(?:,\s*д\.?\s*\d+[А-Яа-я]?)?)/iu;

function trimmed(s: string | undefined): string | undefined {
  const t = s?.trim();
  return t || undefined;
}

function isStructuredStreetHint(hint: string): boolean {
  return STRUCTURED_STREET_ADDRESS_RE.test(hint.trim());
}

/**
 * Оценка качества географического сигнала по уже извлечённым полям (без повторного парсинга текста извещения).
 */
export function assessProcurementGeoSignalQuality(extracted: ProcurementGeoExtracted): ProcurementGeoSignalQualityAssessment {
  const region = trimmed(extracted.region);
  const city = trimmed(extracted.city);
  const district = trimmed(extracted.districtOrOkrug);
  const hint = trimmed(extracted.locationOrAddressHint);

  const hasStructuredAddress = hint !== undefined && isStructuredStreetHint(hint);

  if (hasStructuredAddress) {
    return {
      geoPrecision: 'exact_address',
      confidence: 'high',
      reasonRu: 'Обнаружен адресный фрагмент (улица, шоссе, проспект и т.п.) по правилам извлечения.',
    };
  }

  if (district) {
    return {
      geoPrecision: 'district_level',
      confidence: 'medium',
      reasonRu: 'Указаны район или административный округ; точного адреса в извлечённых полях нет.',
    };
  }

  if (city) {
    return {
      geoPrecision: 'city_level',
      confidence: 'medium',
      reasonRu: 'Указан населённый пункт без района и без адресной строки.',
    };
  }

  if (region) {
    return {
      geoPrecision: 'region_level',
      confidence: 'medium',
      reasonRu: 'Заполнен только субъект/регион без города, района и адреса.',
    };
  }

  if (hint !== undefined && !hasStructuredAddress) {
    return {
      geoPrecision: 'text_hint_only',
      confidence: 'low',
      reasonRu: 'Есть текстовая подсказка по месту без адресного шаблона (улица/шоссе и т.п.) при отсутствии более точных полей.',
    };
  }

  return {
    geoPrecision: 'unknown',
    confidence: 'low',
    reasonRu: 'Географические поля извлечения пусты.',
  };
}
