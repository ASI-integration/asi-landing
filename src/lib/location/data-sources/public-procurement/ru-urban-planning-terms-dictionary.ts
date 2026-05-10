/**
 * Справочный слой российских градостроительных и закупочных аббревиатур (RU).
 * Не смешивать с {@link ./urban-signals-dictionary}: здесь только расшифровки для отчётов,
 * нормализации текстов и будущих источников — без правил классификации сигналов.
 */
export interface RuUrbanPlanningTermEntry {
  readonly abbreviation: string;
  readonly expansionRu: string;
  /** Дополнительные варианты написания аббревиатуры в текстах. */
  readonly aliases?: readonly string[];
}

export const RU_URBAN_PLANNING_TERM_ENTRIES: readonly RuUrbanPlanningTermEntry[] = [
  {
    abbreviation: 'ЕИС',
    expansionRu: 'Единая информационная система в сфере закупок',
    aliases: ['еис'],
  },
  {
    abbreviation: 'ППТ',
    expansionRu: 'проект планировки территории',
    aliases: ['ппт'],
  },
  {
    abbreviation: 'ПМТ',
    expansionRu: 'проект межевания территории',
    aliases: ['пмт'],
  },
  {
    abbreviation: 'ПД',
    expansionRu: 'проектная документация',
    aliases: ['пд'],
  },
  {
    abbreviation: 'РД',
    expansionRu: 'рабочая документация',
    aliases: ['рд'],
  },
  {
    abbreviation: 'ИИ',
    expansionRu: 'инженерные изыскания',
    aliases: ['ии'],
  },
  {
    abbreviation: 'ГПЗУ',
    expansionRu: 'градостроительный план земельного участка',
    aliases: ['гпзу'],
  },
  {
    abbreviation: 'ОКС',
    expansionRu: 'объект капитального строительства',
    aliases: ['окс'],
  },
  {
    abbreviation: 'КРТ',
    expansionRu: 'комплексное развитие территории',
    aliases: ['крт'],
  },
  {
    abbreviation: 'ТПУ',
    expansionRu: 'транспортно-пересадочный узел',
    aliases: ['тпу'],
  },
];

const byAbbrev = new Map<string, RuUrbanPlanningTermEntry>(
  RU_URBAN_PLANNING_TERM_ENTRIES.map(e => [e.abbreviation.toUpperCase(), e]),
);

/** Быстрый доступ по канонической аббревиатуре (регистронезависимо). */
export function lookupRuUrbanPlanningTerm(abbreviation: string): RuUrbanPlanningTermEntry | undefined {
  const k = abbreviation.trim().toUpperCase();
  return byAbbrev.get(k);
}
