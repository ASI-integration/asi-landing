import type {
  ReportSignal,
  ReportSignalAdapterSummary,
  ReportSignalCollectionSummary,
  ReportSignalLayer,
  ReportSignalResultStatus,
} from './report-signal-adapters';

export type ReportSectionStatus = 'ready' | 'empty' | 'warning' | 'failed';

export type ReportSectionItem = {
  id: string;
  label: string;
  value?: unknown;
  source?: string;
  confidence?: ReportSignal['confidence'];
};

export type ReportSection = {
  id: string;
  title: string;
  layer: ReportSignalLayer;
  order: number;
  status: ReportSectionStatus;
  summary: string;
  items: ReportSectionItem[];
  warnings: string[];
  source_adapters: string[];
};

type ReportSectionBuilder = {
  id: string;
  title: string;
  layer: ReportSignalLayer;
  order: number;
  sourceAdapters: readonly string[];
};

const SECTION_BUILDERS = [
  {
    id: 'overview',
    title: 'Обзор объекта',
    layer: 'fast',
    order: 10,
    sourceAdapters: ['base_location'],
  },
  {
    id: 'location',
    title: 'Локация',
    layer: 'fast',
    order: 20,
    sourceAdapters: ['base_location'],
  },
  {
    id: 'transport',
    title: 'Транспорт',
    layer: 'fast',
    order: 30,
    sourceAdapters: ['transport'],
  },
  {
    id: 'magnets',
    title: 'Точки спроса',
    layer: 'fast',
    order: 40,
    sourceAdapters: ['prime_magnets'],
  },
  {
    id: 'competitors',
    title: 'Конкуренты',
    layer: 'full',
    order: 50,
    sourceAdapters: ['competitors'],
  },
  {
    id: 'commercial_potential',
    title: 'Коммерческий потенциал',
    layer: 'full',
    order: 60,
    sourceAdapters: ['commercial_potential'],
  },
  {
    id: 'urban_development',
    title: 'Городское развитие',
    layer: 'full',
    order: 70,
    sourceAdapters: ['urban_development'],
  },
] as const satisfies readonly ReportSectionBuilder[];

function statusFromAdapters(
  adapterStatus: readonly ReportSignalResultStatus[],
  items: readonly ReportSectionItem[],
  warnings: readonly string[],
): ReportSectionStatus {
  if (adapterStatus.some(status => status === 'failed')) return 'failed';
  if (warnings.length > 0) return 'warning';
  if (items.length > 0) return 'ready';
  return 'empty';
}

function summaryForStatus(status: ReportSectionStatus, itemCount: number): string {
  if (status === 'failed') return 'Раздел пока не готов.';
  if (status === 'warning') return 'Раздел собран, но часть данных требует проверки.';
  if (status === 'empty') return 'Раздел подключен, данные будут добавлены позже.';
  return `Найдено пунктов: ${itemCount}.`;
}

function itemFromSignal(sectionId: string, signal: ReportSignal, index: number): ReportSectionItem {
  return {
    id: signal.id || `${sectionId}_${index + 1}`,
    label: signal.label ?? signal.id,
    value: signal.value,
    source: signal.source,
    confidence: signal.confidence,
  };
}

function buildSectionFromAdapters(
  builder: ReportSectionBuilder,
  adapters: readonly ReportSignalAdapterSummary[],
): ReportSection | null {
  const sourceAdapters = adapters.filter(adapter => builder.sourceAdapters.includes(adapter.id));
  if (sourceAdapters.length === 0) return null;

  const items = sourceAdapters.flatMap(adapter =>
    adapter.signals.map((signal, index) => itemFromSignal(builder.id, signal, index)),
  );
  const warnings = sourceAdapters.flatMap(adapter => adapter.warnings);
  const status = statusFromAdapters(
    sourceAdapters.map(adapter => adapter.status),
    items,
    warnings,
  );

  return {
    id: builder.id,
    title: builder.title,
    layer: builder.layer,
    order: builder.order,
    status,
    summary: summaryForStatus(status, items.length),
    items,
    warnings,
    source_adapters: sourceAdapters.map(adapter => adapter.id),
  };
}

export function buildReportSections(
  signalSummary: ReportSignalCollectionSummary,
): ReportSection[] {
  return SECTION_BUILDERS
    .map(builder => buildSectionFromAdapters(builder, signalSummary.adapters))
    .filter((section): section is ReportSection => Boolean(section))
    .sort((left, right) => left.order - right.order);
}
