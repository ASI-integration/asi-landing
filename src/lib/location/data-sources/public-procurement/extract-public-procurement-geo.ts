import type { PublicProcurementNoticeInput } from './classify-notice';

/** Нормализованная география без сырых цитат — для сборки locationReference на сигнале. */
export interface ProcurementGeoExtracted {
  readonly region?: string;
  readonly city?: string;
  readonly districtOrOkrug?: string;
  readonly locationOrAddressHint?: string;
}

export type ProcurementGeoSnippetField = keyof Pick<
  PublicProcurementNoticeInput,
  'regionHint' | 'title' | 'subjectDetail' | 'customer'
>;

/** Исходный фрагмент текста, из которого извели значение (audit / pipeline). */
export interface ProcurementGeoSourceSnippet {
  readonly field: ProcurementGeoSnippetField;
  /** Короткая цитата или значение поля, по которому сработало правило. */
  readonly text: string;
}

export interface ProcurementGeoExtractionResult {
  readonly extracted: ProcurementGeoExtracted;
  readonly sourceSnippets: readonly ProcurementGeoSourceSnippet[];
}

const FEDERAL_CITIES = new Set(['Москва', 'Санкт-Петербург', 'Севастополь', 'Байконур']);

const SUBJECT_SUFFIX_RE = /(область|край|обл\.|Республика|АО|автономный округ)$/iu;

/** Именительный и падежные формы («Южный административный округ», «в Южном административном округе»). */
const ADMIN_OKRUG_RE =
  /([А-ЯЁа-яё][А-Яа-яё\-]{2,40}\s+административн[а-яё]+\s+округ[а-яё]*)/iu;

const RAYON_RE = /район\s+([А-ЯЁ][А-Яа-яё\-]{2,40})/iu;

/** Маркеры административных округов (напр. Москва). */
const OKRUG_ABBR_RE = /\b(ЮАО|САО|СВАО|ВАО|ЮВАО|ЮЗАО|ЗАО|СЗАО|ЗелАО|ЦАО|ТНАО|ТиНАО)\b/i;

const CITY_RE = /(?:г\.|гор\.|город)\s*([А-ЯЁ][А-Яа-яё\-]{1,40})/iu;

const ADDRESS_RE =
  /((?:ул\.|улица|просп\.|проспект|ш\.|шоссе|набережная|пер\.|переулок)\s*[А-Яа-яёA-Za-z0-9\s\-\.]+(?:,\s*д\.?\s*\d+[А-Яа-я]?)?)/iu;

function pushSnippet(
  acc: ProcurementGeoSourceSnippet[],
  field: ProcurementGeoSnippetField,
  excerpt: string,
): void {
  const t = excerpt.trim();
  if (!t) return;
  acc.push({ field, text: t });
}

function pickDistrictFromLine(
  line: string | undefined,
  field: ProcurementGeoSnippetField,
  snippets: ProcurementGeoSourceSnippet[],
): string | undefined {
  if (!line?.trim()) return undefined;

  let m = line.match(ADMIN_OKRUG_RE);
  if (m?.[1]) {
    const v = m[1].trim();
    pushSnippet(snippets, field, v);
    return v;
  }

  m = line.match(RAYON_RE);
  if (m?.[1]) {
    const name = m[1].trim();
    pushSnippet(snippets, field, `район ${name}`);
    return name;
  }

  m = line.match(OKRUG_ABBR_RE);
  if (m?.[1]) {
    const v = m[1].trim();
    pushSnippet(snippets, field, v);
    return v;
  }

  return undefined;
}

function collectDistrict(
  title: string | undefined,
  subject: string | undefined,
  snippets: ProcurementGeoSourceSnippet[],
): string | undefined {
  return (
    pickDistrictFromLine(title, 'title', snippets)
    ?? pickDistrictFromLine(subject, 'subjectDetail', snippets)
  );
}

function collectAddress(
  subject: string | undefined,
  title: string | undefined,
  snippets: ProcurementGeoSourceSnippet[],
): string | undefined {
  const preferSubject = subject?.match(ADDRESS_RE)?.[1]?.trim();
  if (preferSubject) {
    pushSnippet(snippets, 'subjectDetail', preferSubject);
    return preferSubject;
  }
  const fromTitle = title?.match(ADDRESS_RE)?.[1]?.trim();
  if (fromTitle) {
    pushSnippet(snippets, 'title', fromTitle);
    return fromTitle;
  }
  return undefined;
}

function extractCityFromField(
  text: string | undefined,
  field: ProcurementGeoSnippetField,
  snippets: ProcurementGeoSourceSnippet[],
): string | undefined {
  if (!text?.trim()) return undefined;
  const m = text.match(CITY_RE);
  if (!m?.[1]) return undefined;
  pushSnippet(snippets, field, m[0].trim());
  return m[1].trim();
}

/**
 * Извлечение базовой географии из полей извещения (фикстуры и будущие записи каталога).
 * Без внешних запросов и геокодирования — только эвристики по тексту.
 */
type ProcurementGeoMutable = {
  region?: string;
  city?: string;
  districtOrOkrug?: string;
  locationOrAddressHint?: string;
};

export function extractPublicProcurementGeo(validated: PublicProcurementNoticeInput): ProcurementGeoExtractionResult {
  const sourceSnippets: ProcurementGeoSourceSnippet[] = [];
  const extracted: ProcurementGeoMutable = {};

  const hint = validated.regionHint?.trim();
  if (hint) {
    extracted.region = hint;
    pushSnippet(sourceSnippets, 'regionHint', hint);

    if (FEDERAL_CITIES.has(hint)) {
      extracted.city = hint;
    }
    else if (SUBJECT_SUFFIX_RE.test(hint)) {
      const cityInline =
        extractCityFromField(validated.subjectDetail, 'subjectDetail', sourceSnippets)
        ?? extractCityFromField(validated.title, 'title', sourceSnippets);
      if (cityInline) extracted.city = cityInline;
    }
    else {
      extracted.city = hint;
    }
  }
  else {
    const cityInline =
      extractCityFromField(validated.subjectDetail, 'subjectDetail', sourceSnippets)
      ?? extractCityFromField(validated.title, 'title', sourceSnippets);
    if (cityInline) extracted.city = cityInline;
  }

  const district = collectDistrict(validated.title, validated.subjectDetail, sourceSnippets);
  if (district) extracted.districtOrOkrug = district;

  const addr = collectAddress(validated.subjectDetail, validated.title, sourceSnippets);
  if (addr) extracted.locationOrAddressHint = addr;

  return { extracted: extracted as ProcurementGeoExtracted, sourceSnippets };
}

/** Сборка одной строки для {@link UrbanDevelopmentSignal.locationReference} без сырых дампов полей. */
export function composeProcurementLocationReference(extracted: ProcurementGeoExtracted): string | undefined {
  const parts: string[] = [];
  const region = extracted.region?.trim();
  const city = extracted.city?.trim();
  const district = extracted.districtOrOkrug?.trim();
  const addr = extracted.locationOrAddressHint?.trim();

  if (region && city && region !== city) {
    parts.push(region, city);
  }
  else if (region) {
    parts.push(region);
  }
  else if (city) {
    parts.push(city);
  }

  if (district && !parts.some(p => p.includes(district))) parts.push(district);
  if (addr && !parts.some(p => p.includes(addr))) parts.push(addr);

  const line = parts.join(', ').replace(/\s+/g, ' ').trim();
  return line || undefined;
}
