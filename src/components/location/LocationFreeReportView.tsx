import Link from 'next/link';
import type { GeneratedFreeLocationReportData } from '@/lib/location/location-report-engine';
import { buildDashboardReportRequestHref } from '@/lib/location/pending-location-report';

const MAX_FREE_REPORT_FACTORS = 5;

const FREE_REPORT_NEXT_STEP_TEXT =
  'Бесплатный отчёт показывает общий потенциал локации. Подробный отчёт добавит экономику, конкурентов, риски, транспорт, окружение и рекомендации по запуску.';

const FREE_REPORT_RISK_TEXT =
  'Это предварительный общий вывод. Подробная экономика, конкуренция и сценарии запуска доступны в полном отчёте.';

type FactorKind =
  | 'medical'
  | 'metro'
  | 'transport'
  | 'education'
  | 'business'
  | 'tourism'
  | 'services'
  | 'generic';

type ParsedFactor = {
  raw: string;
  kind: FactorKind;
  distanceMeters: number | null;
  fallbackText?: string;
};

function formatDateRu(iso: string): string {
  const d = new Date(iso);
  if (!Number.isFinite(d.getTime())) return iso;
  return d.toLocaleString('ru-RU', {
    day: 'numeric',
    month: 'long',
    year: 'numeric',
    hour: '2-digit',
    minute: '2-digit',
  });
}

function cleanText(value: string): string {
  return value.replace(/\s+/g, ' ').trim();
}

function parseDistanceMeters(value: string): number | null {
  const match = value.match(/(\d+(?:[.,]\d+)?)\s*(км|м)(?=\s|$|[—.,;:)])/i);
  if (!match) return null;
  const amount = Number(match[1].replace(',', '.'));
  if (!Number.isFinite(amount)) return null;
  return match[2].toLowerCase() === 'км' ? Math.round(amount * 1000) : Math.round(amount);
}

function formatDistanceRu(meters: number): string {
  if (meters < 1000) return `${Math.round(meters / 10) * 10} м`;
  return `${(meters / 1000).toFixed(1).replace('.', ',')} км`;
}

function formatDistanceRangeRu(distances: number[]): string | null {
  const valid = distances.filter(value => Number.isFinite(value) && value >= 0);
  if (!valid.length) return null;
  const min = Math.min(...valid);
  const max = Math.max(...valid);
  if (Math.abs(max - min) < 25) return formatDistanceRu(min);
  if (max < 1000) return `${Math.round(min / 10) * 10}–${Math.round(max / 10) * 10} м`;
  if (min >= 1000) {
    return `${(min / 1000).toFixed(1).replace('.', ',')}–${(max / 1000).toFixed(1).replace('.', ',')} км`;
  }
  return `${formatDistanceRu(min)}–${formatDistanceRu(max)}`;
}

function factorKind(value: string): FactorKind {
  const text = value.toLowerCase();
  if (/метро/.test(text)) return 'metro';
  if (/мед|больниц|клиник|госпитал|поликлиник|аптек/.test(text)) return 'medical';
  if (/транспорт|вокзал|станци|аэропорт|останов|мцд|автобус|ж\/д|железн/.test(text)) return 'transport';
  if (/универс|институт|школ|образован|вуз/.test(text)) return 'education';
  if (/бизнес|офис|делов|промышлен|технопарк/.test(text)) return 'business';
  if (/турис|достопр|музе|театр|парк|событ|досуг/.test(text)) return 'tourism';
  if (/сервис|магазин|торгов|тц|инфраструкт|кафе|ресторан|городск|локальн/.test(text)) return 'services';
  return 'generic';
}

function factorText(kind: FactorKind, distances: number[]): string {
  const distance = formatDistanceRangeRu(distances);
  const suffix = distance ? `: около ${distance}` : '';

  if (kind === 'medical') return `Медицинские учреждения рядом${suffix}`;
  if (kind === 'metro') return `Метро в пешей доступности${suffix}`;
  if (kind === 'transport') return `Транспорт рядом${suffix}`;
  if (kind === 'education') return `Учебные учреждения рядом${suffix}`;
  if (kind === 'business') return `Деловая инфраструктура рядом${suffix}`;
  if (kind === 'tourism') return `Точки досуга и событий рядом${suffix}`;
  if (kind === 'services') return `Городская инфраструктура рядом${suffix}`;
  return `Сильные объекты спроса рядом${suffix}`;
}

function fallbackFactorText(raw: string): string | null {
  const cleaned = cleanText(raw)
    .replace(/\s*—\s*/g, ' — ')
    .replace(/\s*·\s*/g, ' · ');
  if (!cleaned) return null;

  const distance = parseDistanceMeters(cleaned);
  const kind = factorKind(cleaned);
  if (cleaned.includes('·') && distance != null) return factorText(kind, [distance]);
  if (/·.*·.*—.*—/.test(cleaned)) return factorText(kind, distance == null ? [] : [distance]);
  return cleaned;
}

function parseFactor(rawFactor: string): ParsedFactor | null {
  const raw = cleanText(rawFactor);
  if (!raw) return null;

  const parts = raw.split('·').map(cleanText).filter(Boolean);
  if (parts.length >= 3) {
    const [name, category, ...rest] = parts;
    const tail = rest.join(' · ');
    const distanceMeters = parseDistanceMeters(tail) ?? parseDistanceMeters(raw);
    return {
      raw,
      kind: factorKind(`${name} ${category}`),
      distanceMeters,
    };
  }

  return {
    raw,
    kind: factorKind(raw),
    distanceMeters: parseDistanceMeters(raw),
    fallbackText: fallbackFactorText(raw) ?? undefined,
  };
}

export function normalizeFreeReportFactors(rawFactors: string[]): string[] {
  const parsed: ParsedFactor[] = [];
  const seenRawFacts = new Set<string>();

  for (const rawFactor of rawFactors) {
    const factor = parseFactor(rawFactor);
    if (!factor) continue;

    const key = `${factor.kind}:${factor.distanceMeters ?? 'no-distance'}:${factor.raw.toLowerCase()}`;
    if (seenRawFacts.has(key)) continue;
    seenRawFacts.add(key);
    parsed.push(factor);
  }

  const grouped = new Map<FactorKind, number[]>();
  const fallbackTexts: string[] = [];
  for (const factor of parsed) {
    if (factor.fallbackText && !factor.fallbackText.includes('·')) {
      fallbackTexts.push(factor.fallbackText);
      continue;
    }
    const distances = grouped.get(factor.kind) ?? [];
    if (factor.distanceMeters != null) distances.push(factor.distanceMeters);
    grouped.set(factor.kind, distances);
  }

  const out: string[] = [];
  const seenText = new Set<string>();
  for (const factor of parsed) {
    if (out.length >= MAX_FREE_REPORT_FACTORS) break;
    const text = factor.fallbackText && !factor.fallbackText.includes('·')
      ? factor.fallbackText
      : factorText(factor.kind, grouped.get(factor.kind) ?? []);
    if (seenText.has(text)) continue;
    seenText.add(text);
    out.push(text);
  }

  for (const text of fallbackTexts) {
    if (out.length >= MAX_FREE_REPORT_FACTORS) break;
    if (seenText.has(text)) continue;
    seenText.add(text);
    out.push(text);
  }

  return out;
}

export function LocationFreeReportView({ report }: { report: GeneratedFreeLocationReportData }) {
  const reportHref = `/ru/location-report/${encodeURIComponent(report.reportId)}`;
  const pdfHref = report.pdfUrl ?? `${reportHref}/print`;
  const evidenceBullets = normalizeFreeReportFactors(report.evidenceBullets);
  const detailedReportHref = buildDashboardReportRequestHref({
    address: report.inputAddress,
    freeReportId: report.reportId,
    freeReportPermalink: reportHref,
    mode: 'residential',
    createdAt: report.calculatedAt,
  });

  return (
    <div className="min-h-screen bg-slate-950 text-white">
      <header className="border-b border-slate-800/70 bg-slate-950/90">
        <div className="mx-auto flex max-w-5xl flex-col gap-3 px-4 py-4 sm:flex-row sm:items-center sm:justify-between sm:px-6">
          <div className="min-w-0">
            <p className="text-[11px] uppercase tracking-[0.22em] text-slate-500">Бесплатный отчёт по локации</p>
            <p className="mt-1 truncate text-sm text-slate-200" title={report.inputAddress}>{report.inputAddress}</p>
          </div>
          <div className="flex flex-wrap gap-2">
            <Link
              href={pdfHref}
              className="inline-flex items-center justify-center rounded-lg border border-slate-800/70 px-4 py-2 text-sm text-slate-200 transition-colors hover:border-slate-700 hover:text-white"
            >
              Скачать отчёт PDF
            </Link>
            <Link
              href="/ru"
              className="inline-flex items-center justify-center rounded-lg border border-slate-800/70 px-4 py-2 text-sm text-slate-300 transition-colors hover:border-slate-700 hover:text-white"
            >
              На главную
            </Link>
          </div>
        </div>
      </header>

      <main className="mx-auto max-w-5xl px-4 py-10 sm:px-6 sm:py-12">
        <section className="rounded-3xl border border-slate-800/70 bg-slate-900/25 p-7 sm:p-10">
          <p className="text-sm font-semibold text-slate-300">Анализ локации ASI</p>
          <h1 className="mt-3 text-3xl font-bold tracking-tight text-white sm:text-4xl">
            Бесплатный общий отчёт по локации
          </h1>
          <p className="mt-4 max-w-3xl text-lg leading-relaxed text-slate-200">{report.verdictSummary}</p>

          <div className="mt-7 grid gap-3 sm:grid-cols-3">
            <div className="rounded-2xl border border-slate-800/70 bg-slate-950/35 p-5 sm:col-span-2">
              <p className="text-[11px] uppercase tracking-[0.22em] text-slate-500">Адрес</p>
              <p className="mt-2 text-sm leading-relaxed text-slate-200">{report.inputAddress}</p>
            </div>
            <div className="rounded-2xl border border-slate-800/70 bg-slate-950/35 p-5">
              <p className="text-[11px] uppercase tracking-[0.22em] text-slate-500">Оценка</p>
              <p className="mt-2 text-3xl font-bold tabular-nums text-white">
                {report.score ?? '—'}
                {report.score == null ? null : <span className="text-base font-medium text-slate-500"> / 100</span>}
              </p>
            </div>
          </div>

          <div className="mt-5 rounded-2xl border border-slate-800/70 bg-slate-950/35 p-5 text-sm leading-relaxed text-slate-300">
            <p>Расчёт: {formatDateRu(report.calculatedAt)}</p>
            <p className="mt-1 text-xs text-slate-500">Номер отчёта: {report.reportId}</p>
            {report.dataFreshness?.summaryRu ? (
              <p className="mt-3 text-slate-400">{report.dataFreshness.summaryRu}</p>
            ) : null}
          </div>
        </section>

        <div className="mt-8 grid gap-6 lg:grid-cols-3">
          <section className="rounded-2xl border border-slate-800/70 bg-slate-900/20 p-6 lg:col-span-2">
            <h2 className="text-2xl font-bold text-white">Ключевые факторы</h2>
            {evidenceBullets.length ? (
              <ul className="mt-4 space-y-3">
                {evidenceBullets.map(item => (
                  <li key={item} className="flex gap-3 text-slate-200">
                    <span className="mt-2 h-1.5 w-1.5 shrink-0 rounded-full bg-indigo-400" />
                    <span className="leading-relaxed">{item}</span>
                  </li>
                ))}
              </ul>
            ) : (
              <p className="mt-3 text-slate-400">По этому адресу пока нет коротких факторов для показа.</p>
            )}
          </section>

          <section className="rounded-2xl border border-slate-800/70 bg-slate-900/20 p-6">
            <h2 className="text-2xl font-bold text-white">Что дальше</h2>
            <p className="mt-3 text-sm leading-relaxed text-slate-300">{FREE_REPORT_NEXT_STEP_TEXT}</p>
            <Link
              href={pdfHref}
              className="mt-5 inline-flex w-full items-center justify-center rounded-xl bg-white px-6 py-3 text-sm font-bold text-slate-900 transition-colors hover:bg-slate-100"
            >
              Скачать отчёт PDF
            </Link>
            <Link
              href={detailedReportHref}
              className="mt-3 inline-flex w-full items-center justify-center rounded-xl border border-slate-700 px-6 py-3 text-sm font-bold text-white transition-colors hover:border-slate-500"
            >
              Получить подробный отчёт
            </Link>
          </section>
        </div>

        <section className="mt-6 rounded-2xl border border-slate-800/70 bg-slate-900/20 p-6">
          <h2 className="text-2xl font-bold text-white">Риски и ограничения</h2>
          <p className="mt-3 text-sm leading-relaxed text-slate-300">{FREE_REPORT_RISK_TEXT}</p>
        </section>
      </main>
    </div>
  );
}
