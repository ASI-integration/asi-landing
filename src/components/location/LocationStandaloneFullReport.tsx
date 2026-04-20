'use client';

import { useMemo, useState } from 'react';
import Link from 'next/link';
import type { LocationStandaloneReport, LocationStandaloneReportSectionId } from '@/lib/location';

function fmtRub(n: number | null): string {
  if (n == null || !Number.isFinite(n)) return '—';
  return `₽${Math.round(n).toLocaleString('ru-RU')}`;
}

function fmtMeters(m: number): string {
  if (!Number.isFinite(m)) return '—';
  if (m < 1000) return `${Math.round(m / 10) * 10} м`;
  return `${(m / 1000).toFixed(1)} км`;
}

type AnchorType = 'POSITIVE_DEMAND_ANCHOR' | 'MIXED_CONTEXT_ANCHOR' | 'RESTRICTIVE_OR_FRICTION_ANCHOR';

function AnchorTypeBadge({ anchorType }: { anchorType: AnchorType | undefined }) {
  if (!anchorType || anchorType === 'POSITIVE_DEMAND_ANCHOR') return null;
  if (anchorType === 'MIXED_CONTEXT_ANCHOR') {
    return (
      <span className="inline-block px-1.5 py-0.5 rounded text-[10px] font-medium bg-amber-900/40 text-amber-300 border border-amber-700/40">
        Смешанный контекст
      </span>
    );
  }
  return (
    <span className="inline-block px-1.5 py-0.5 rounded text-[10px] font-medium bg-rose-900/40 text-rose-300 border border-rose-700/40">
      Фрикционный объект
    </span>
  );
}

function strategyTitleRu(s: NonNullable<LocationStandaloneReport['sections'][number] & { id: 'summary' }>['recommended_strategy']): string {
  if (s === 'short_term') return 'Посуточная аренда (деловой фокус)';
  if (s === 'hybrid') return 'Гибрид (посуточно + среднесрок)';
  return 'Среднесрочная аренда';
}

function pressureLabelRu(p: 'low' | 'medium' | 'high'): { label: string; className: string } {
  if (p === 'low') return { label: 'низкое', className: 'text-emerald-300' };
  if (p === 'medium') return { label: 'среднее', className: 'text-amber-300' };
  return { label: 'высокое', className: 'text-rose-300' };
}

function fitLabelRu(v: 'fit' | 'not_fit' | 'unknown'): { title: string; className: string } {
  if (v === 'fit') return { title: 'Подходит', className: 'text-emerald-300' };
  if (v === 'not_fit') return { title: 'Скорее не подходит', className: 'text-slate-200' };
  return { title: 'Недостаточно данных', className: 'text-slate-400' };
}

function pickSection<T extends LocationStandaloneReportSectionId>(
  report: LocationStandaloneReport,
  id: T,
): Extract<LocationStandaloneReport['sections'][number], { id: T }> | null {
  const s = report.sections.find(x => x.id === id);
  return (s ?? null) as any;
}

function SectionShell({
  id,
  title,
  lead,
  children,
}: {
  id: string;
  title: string;
  lead?: string;
  children: React.ReactNode;
}) {
  return (
    <section id={id} className="scroll-mt-24">
      <div className="rounded-2xl border border-slate-800/70 bg-slate-900/20 overflow-hidden">
        <div className="px-6 sm:px-8 pt-6 sm:pt-7 pb-5 border-b border-slate-800/60">
          <p className="text-[11px] uppercase tracking-[0.22em] text-slate-500">Раздел</p>
          <h2 className="mt-2 text-2xl sm:text-3xl font-bold tracking-tight text-white">{title}</h2>
          {lead ? <p className="mt-3 text-slate-300 leading-relaxed max-w-3xl">{lead}</p> : null}
        </div>
        <div className="px-6 sm:px-8 py-6 sm:py-7">{children}</div>
      </div>
    </section>
  );
}

function Toc({ items }: { items: Array<{ id: string; label: string }> }) {
  return (
    <div className="rounded-2xl border border-slate-800/70 bg-slate-950/40 p-5">
      <p className="text-[11px] uppercase tracking-[0.22em] text-slate-500">Навигация по отчёту</p>
      <div className="mt-3 grid grid-cols-2 sm:grid-cols-3 gap-2">
        {items.map(i => (
          <a
            key={i.id}
            href={`#${i.id}`}
            className="text-sm text-slate-300 hover:text-white transition-colors rounded-lg px-3 py-2 bg-slate-900/30 border border-slate-800/60 hover:border-slate-700/70"
          >
            {i.label}
          </a>
        ))}
      </div>
    </div>
  );
}

export function LocationStandaloneFullReport({
  report,
}: {
  report: LocationStandaloneReport;
}) {
  const summary = pickSection(report, 'summary');
  const businessFit = pickSection(report, 'business_fit');
  const magnets = pickSection(report, 'magnets');
  const competition = pickSection(report, 'competition');
  const incomeStrategy = pickSection(report, 'income_strategy');

  const tocItems = useMemo(() => ([
    { id: 'summary', label: 'Итог' },
    { id: 'business-fit', label: 'Business-fit' },
    { id: 'magnets', label: 'Магниты' },
    { id: 'competition', label: 'Конкуренция' },
    { id: 'income-strategy', label: 'Доход / стратегия' },
    { id: 'next-step', label: 'Следующий шаг' },
  ]), []);

  const generatedAt = useMemo(() => {
    const d = new Date(report.generated_at_iso);
    if (!Number.isFinite(d.getTime())) return null;
    return d.toLocaleString('ru-RU', { day: 'numeric', month: 'long', year: 'numeric', hour: '2-digit', minute: '2-digit' });
  }, [report.generated_at_iso]);

  const [shareStatus, setShareStatus] = useState<'idle' | 'copied' | 'failed'>('idle');
  const canShare = typeof window !== 'undefined' && typeof navigator !== 'undefined' && !!navigator.clipboard;
  const shareLink = async () => {
    try {
      if (!canShare) throw new Error('clipboard not available');
      await navigator.clipboard.writeText(window.location.href);
      setShareStatus('copied');
      window.setTimeout(() => setShareStatus('idle'), 2200);
    } catch {
      setShareStatus('failed');
      window.setTimeout(() => setShareStatus('idle'), 2200);
    }
  };

  return (
    <div className="min-h-screen bg-slate-950 text-white">
      <header className="sticky top-0 z-40 bg-slate-950/80 backdrop-blur-md border-b border-slate-800/70">
        <div className="max-w-5xl mx-auto px-4 sm:px-6 py-3 flex items-center justify-between gap-4">
          <div className="min-w-0">
            <p className="text-[11px] uppercase tracking-[0.22em] text-slate-500">Полный отчёт по локации</p>
            <p className="mt-1 text-sm text-slate-200 truncate" title={report.address}>{report.address}</p>
          </div>
          <div className="flex items-center gap-2 shrink-0">
            <a
              href="#next-step"
              className="hidden sm:inline-flex items-center justify-center px-4 py-2 rounded-lg bg-indigo-500 hover:bg-indigo-400 text-white font-semibold text-sm transition-colors"
            >
              Получить полный разбор
            </a>
            <Link
              href="/ru"
              className="inline-flex items-center justify-center px-3 py-2 rounded-lg border border-slate-800/70 text-slate-300 hover:text-white hover:border-slate-700 transition-colors text-sm"
            >
              На главную
            </Link>
          </div>
        </div>
      </header>

      <main className="max-w-5xl mx-auto px-4 sm:px-6 py-10 sm:py-12">
        {/* Hero */}
        <div className="rounded-3xl border border-slate-800/70 bg-gradient-to-br from-slate-900/40 to-slate-950/20 p-7 sm:p-10">
          <div className="flex flex-col gap-5">
            <div>
              <p className="text-[11px] uppercase tracking-[0.22em] text-slate-500">
                ASI · Location Intelligence · {generatedAt ? `сформировано ${generatedAt}` : 'сформировано'}
              </p>
              <h1 className="mt-3 text-3xl sm:text-4xl font-bold tracking-tight leading-tight text-white">
                Отчёт по потенциалу локации
              </h1>
              <p className="mt-3 text-slate-300 leading-relaxed max-w-3xl">
                Документ для решения "стоит ли заходить в объект" и какой моделью дохода идти: посуточно, среднесрок или гибрид.
              </p>
            </div>

            <div className="grid sm:grid-cols-3 gap-3">
              <div className="rounded-2xl border border-slate-800/70 bg-slate-950/30 p-5">
                <p className="text-[11px] uppercase tracking-[0.22em] text-slate-500">Адрес</p>
                <p className="mt-2 text-sm text-slate-200 leading-snug">{report.address}</p>
              </div>
              <div className="rounded-2xl border border-slate-800/70 bg-slate-950/30 p-5">
                <p className="text-[11px] uppercase tracking-[0.22em] text-slate-500">Ориентир по доходу</p>
                <p className="mt-2 text-xl font-bold text-white tabular-nums">
                  {summary?.income_rub_month != null ? `${fmtRub(summary.income_rub_month)} / мес` : '—'}
                </p>
                <p className="mt-1 text-xs text-slate-500">До расходов и комиссий управления</p>
              </div>
              <div className="rounded-2xl border border-slate-800/70 bg-slate-950/30 p-5">
                <p className="text-[11px] uppercase tracking-[0.22em] text-slate-500">Рекомендуемая стратегия</p>
                <p className="mt-2 text-sm font-semibold text-slate-100">
                  {summary?.recommended_strategy ? strategyTitleRu(summary.recommended_strategy) : '—'}
                </p>
                <p className="mt-1 text-xs text-slate-500">Вывод из окружения + конкуренции</p>
              </div>
            </div>

            <Toc items={tocItems} />
          </div>
        </div>

        <div className="mt-10 sm:mt-12 space-y-6">
          {/* 1) Summary */}
          <SectionShell
            id="summary"
            title="Итог"
            lead="Первое, что важно: вердикт и 3 драйвера, которые дают основной вклад в спрос и стратегию."
          >
            <div className="grid lg:grid-cols-3 gap-5">
              <div className="lg:col-span-2">
                <div className="rounded-2xl border border-slate-800/70 bg-slate-950/30 p-6">
                  <p className="text-[11px] uppercase tracking-[0.22em] text-slate-500">Вердикт</p>
                  <p className="mt-2 text-lg sm:text-xl font-semibold text-white leading-snug">
                    {summary?.verdict ?? '—'}
                  </p>
                </div>

                <div className="mt-4 rounded-2xl border border-slate-800/70 bg-slate-950/30 p-6">
                  <p className="text-[11px] uppercase tracking-[0.22em] text-slate-500">Главные драйверы</p>
                  {summary?.drivers?.length ? (
                    <ul className="mt-3 space-y-2">
                      {summary.drivers.slice(0, 3).map((d, i) => (
                        <li key={i} className="flex gap-3">
                          <span className="mt-2 w-1.5 h-1.5 rounded-full bg-indigo-400 shrink-0" />
                          <span className="text-slate-200 leading-relaxed">{d}</span>
                        </li>
                      ))}
                    </ul>
                  ) : (
                    <p className="mt-3 text-slate-400">Нет данных по драйверам.</p>
                  )}
                </div>
              </div>

              <div className="rounded-2xl border border-slate-800/70 bg-slate-950/30 p-6">
                <p className="text-[11px] uppercase tracking-[0.22em] text-slate-500">Что делаем с этим</p>
                <div className="mt-3 space-y-3">
                  <div className="rounded-xl border border-slate-800/70 bg-slate-900/20 p-4">
                    <p className="text-xs text-slate-500 uppercase tracking-[0.18em]">Стратегия</p>
                    <p className="mt-1 text-sm font-semibold text-white">
                      {summary?.recommended_strategy ? strategyTitleRu(summary.recommended_strategy) : '—'}
                    </p>
                  </div>
                  <div className="rounded-xl border border-slate-800/70 bg-slate-900/20 p-4">
                    <p className="text-xs text-slate-500 uppercase tracking-[0.18em]">Доход (ориентир)</p>
                    <p className="mt-1 text-lg font-bold text-white tabular-nums">
                      {summary?.income_rub_month != null ? fmtRub(summary.income_rub_month) : '—'}
                      <span className="text-slate-500 text-sm font-normal"> / мес</span>
                    </p>
                    <p className="mt-1 text-xs text-slate-600">Потенциал реализуется при корректной упаковке и каналах</p>
                  </div>
                </div>
              </div>
            </div>
          </SectionShell>

          {/* 2) Business-fit */}
          <SectionShell
            id="business-fit"
            title="Business-fit"
            lead="Оцениваем, тянет ли локация деловой сценарий: командировки, проектные команды, корпоративные размещения."
          >
            {businessFit ? (
              <div className="grid lg:grid-cols-3 gap-5">
                <div className="lg:col-span-1 rounded-2xl border border-slate-800/70 bg-slate-950/30 p-6">
                  <p className="text-[11px] uppercase tracking-[0.22em] text-slate-500">Вердикт</p>
                  <p className={`mt-2 text-xl font-bold ${fitLabelRu(businessFit.business_fit_verdict).className}`}>
                    {fitLabelRu(businessFit.business_fit_verdict).title}
                  </p>
                  {businessFit.note ? (
                    <p className="mt-3 text-sm text-slate-300 leading-relaxed">{businessFit.note}</p>
                  ) : (
                    <p className="mt-3 text-sm text-slate-500 leading-relaxed">
                      Нужны дополнительные сигналы (аудитория/магниты), чтобы дать уверенный вывод.
                    </p>
                  )}
                </div>

                <div className="lg:col-span-2 rounded-2xl border border-slate-800/70 bg-slate-950/30 p-6">
                  <p className="text-[11px] uppercase tracking-[0.22em] text-slate-500">Первостепенные магниты</p>
                  {businessFit.primary_magnets.length ? (
                    <div className="mt-4 grid sm:grid-cols-2 gap-3">
                      {businessFit.primary_magnets.map((m, i) => (
                        <div key={i} className="rounded-xl border border-slate-800/70 bg-slate-900/20 p-4">
                          <div className="flex items-start gap-2 flex-wrap">
                            <p className="text-sm font-semibold text-white leading-snug flex-1">{m.title}</p>
                            {m.anchor_type && <AnchorTypeBadge anchorType={m.anchor_type as AnchorType} />}
                          </div>
                          <p className="mt-1 text-xs text-slate-500">Дистанция: {fmtMeters(m.distance_m)}</p>
                        </div>
                      ))}
                    </div>
                  ) : (
                    <p className="mt-3 text-slate-400">Магниты не найдены.</p>
                  )}
                </div>
              </div>
            ) : (
              <p className="text-slate-400">Секция business-fit отсутствует в данных отчёта.</p>
            )}
          </SectionShell>

          {/* 3) Главные магниты */}
          <SectionShell
            id="magnets"
            title="Главные магниты"
            lead="Устойчивые точки притяжения вокруг объекта — то, что формирует реальный спрос на проживание рядом. Только крупные городские и региональные якоря."
          >
            {magnets ? (
              <>
                {magnets.no_magnets_note ? (
                  <div className="rounded-2xl border border-slate-800/70 bg-slate-950/30 p-6">
                    <p className="text-slate-400 leading-relaxed">{magnets.no_magnets_note}</p>
                  </div>
                ) : (
                  <div className="space-y-5">
                    {magnets.primary.length > 0 && (
                      <div className="rounded-2xl border border-slate-800/70 bg-slate-950/30 p-6">
                        <p className="text-[11px] uppercase tracking-[0.22em] text-slate-500">Основные магниты</p>
                        <div className="mt-4 space-y-3">
                          {magnets.primary.map((m, i) => (
                            <div key={i} className="flex items-start justify-between gap-3 py-2 border-b border-slate-800/60 last:border-0">
                              <div className="min-w-0 flex-1">
                                <div className="flex items-center gap-2 flex-wrap">
                                  <p className="text-sm font-semibold text-white">{m.name}</p>
                                  <AnchorTypeBadge anchorType={m.anchor_type as AnchorType} />
                                </div>
                                <p className="mt-0.5 text-xs text-slate-500">{m.category_label_ru ?? m.category_id}</p>
                              </div>
                              <span className="text-sm text-slate-300 tabular-nums shrink-0">{fmtMeters(m.distance_m)}</span>
                            </div>
                          ))}
                        </div>
                      </div>
                    )}

                    {magnets.secondary.length > 0 && (
                      <div className="rounded-2xl border border-slate-800/70 bg-slate-950/30 p-6">
                        <p className="text-[11px] uppercase tracking-[0.22em] text-slate-500">Дополнительные магниты</p>
                        <div className="mt-4 space-y-3">
                          {magnets.secondary.map((m, i) => (
                            <div key={i} className="flex items-start justify-between gap-3 py-2 border-b border-slate-800/60 last:border-0">
                              <div className="min-w-0 flex-1">
                                <div className="flex items-center gap-2 flex-wrap">
                                  <p className="text-sm text-slate-200">{m.name}</p>
                                  <AnchorTypeBadge anchorType={m.anchor_type as AnchorType} />
                                </div>
                                <p className="mt-0.5 text-xs text-slate-500">{m.category_label_ru ?? m.category_id}</p>
                              </div>
                              <span className="text-sm text-slate-400 tabular-nums shrink-0">{fmtMeters(m.distance_m)}</span>
                            </div>
                          ))}
                        </div>
                      </div>
                    )}

                    {magnets.primary.length === 0 && magnets.secondary.length === 0 && (
                      <div className="rounded-2xl border border-slate-800/70 bg-slate-950/30 p-6">
                        <p className="text-slate-400">Prime-магниты в зоне 1 км не обнаружены.</p>
                      </div>
                    )}
                  </div>
                )}
              </>
            ) : (
              <p className="text-slate-400">Секция магнитов отсутствует в данных отчёта.</p>
            )}
          </SectionShell>

          {/* 4) Конкуренция */}
          <SectionShell
            id="competition"
            title="Конкуренция"
            lead="Чем выше давление конкурентов, тем больше значение имеют упаковка, ценовая стратегия и каналы продаж."
          >
            {competition ? (
              <div className="grid sm:grid-cols-3 gap-3">
                <div className="rounded-2xl border border-slate-800/70 bg-slate-950/30 p-6">
                  <p className="text-[11px] uppercase tracking-[0.22em] text-slate-500">Конкурентов рядом</p>
                  <p className="mt-2 text-3xl font-bold text-white tabular-nums">{competition.competitor_count}</p>
                  <p className="mt-1 text-xs text-slate-600">Счётчик по данным анализа</p>
                </div>

                <div className="rounded-2xl border border-slate-800/70 bg-slate-950/30 p-6 sm:col-span-2">
                  <p className="text-[11px] uppercase tracking-[0.22em] text-slate-500">Давление конкуренции</p>
                  <p className={`mt-2 text-2xl font-bold ${pressureLabelRu(competition.pressure_level).className}`}>
                    {pressureLabelRu(competition.pressure_level).label}
                  </p>
                  <p className="mt-3 text-sm text-slate-300 leading-relaxed">
                    При {competition.pressure_level === 'high' ? 'высоком' : competition.pressure_level === 'medium' ? 'среднем' : 'низком'} давлении
                    ключевой рычаг — позиционирование и дисциплина по цене/каналам.
                  </p>
                </div>
              </div>
            ) : (
              <p className="text-slate-400">Секция конкуренции отсутствует в данных отчёта.</p>
            )}
          </SectionShell>

          {/* 5) Доход / стратегия */}
          <SectionShell
            id="income-strategy"
            title="Доход / стратегия"
            lead="Сравниваем потенциал дохода по трём моделям и фиксируем, какая стратегия даёт лучший баланс спроса и конкуренции."
          >
            {incomeStrategy ? (
              <div className="grid lg:grid-cols-3 gap-5">
                <div className="lg:col-span-2 rounded-2xl border border-slate-800/70 bg-slate-950/30 p-6">
                  <p className="text-[11px] uppercase tracking-[0.22em] text-slate-500">Сравнение стратегий</p>
                  <div className="mt-4 grid sm:grid-cols-3 gap-3">
                    {([
                      { key: 'short_term', label: 'Посуточно', val: incomeStrategy.monthly_income_rub.short_term },
                      { key: 'hybrid', label: 'Гибрид', val: incomeStrategy.monthly_income_rub.hybrid },
                      { key: 'mid_term', label: 'Среднесрок', val: incomeStrategy.monthly_income_rub.mid_term },
                    ] as const).map(s => {
                      const isRec = incomeStrategy.recommended_strategy === s.key;
                      return (
                        <div
                          key={s.key}
                          className={`rounded-2xl border p-5 ${isRec ? 'border-indigo-500/50 bg-indigo-500/10' : 'border-slate-800/70 bg-slate-900/20'}`}
                        >
                          <p className="text-xs text-slate-500 uppercase tracking-[0.18em]">{s.label}</p>
                          <p className="mt-2 text-xl font-bold text-white tabular-nums">
                            {fmtRub(s.val)}
                            <span className="text-slate-500 text-sm font-normal"> / мес</span>
                          </p>
                          {isRec ? (
                            <p className="mt-2 text-xs text-indigo-200">Рекомендовано</p>
                          ) : (
                            <p className="mt-2 text-xs text-slate-600">Альтернатива</p>
                          )}
                        </div>
                      );
                    })}
                  </div>
                  {incomeStrategy.positioning_hint ? (
                    <p className="mt-5 text-sm text-slate-300 leading-relaxed">{incomeStrategy.positioning_hint}</p>
                  ) : null}
                </div>

                <div className="rounded-2xl border border-slate-800/70 bg-slate-950/30 p-6">
                  <p className="text-[11px] uppercase tracking-[0.22em] text-slate-500">Стратегический акцент</p>
                  <div className="mt-3 space-y-3">
                    <div className="rounded-xl border border-slate-800/70 bg-slate-900/20 p-4">
                      <p className="text-xs text-slate-500 uppercase tracking-[0.18em]">Рекомендация</p>
                      <p className="mt-1 text-sm font-semibold text-white">
                        {incomeStrategy.recommended_strategy ? strategyTitleRu(incomeStrategy.recommended_strategy as any) : '—'}
                      </p>
                    </div>
                    <div className="rounded-xl border border-slate-800/70 bg-slate-900/20 p-4">
                      <p className="text-xs text-slate-500 uppercase tracking-[0.18em]">Что докручиваем</p>
                      <ul className="mt-2 space-y-2 text-sm text-slate-300 leading-relaxed">
                        <li className="flex gap-3"><span className="mt-2 w-1.5 h-1.5 rounded-full bg-slate-600 shrink-0" />Упаковка под целевой спрос (оформление + УТП)</li>
                        <li className="flex gap-3"><span className="mt-2 w-1.5 h-1.5 rounded-full bg-slate-600 shrink-0" />Ценообразование под конкуренцию и сезонность</li>
                        <li className="flex gap-3"><span className="mt-2 w-1.5 h-1.5 rounded-full bg-slate-600 shrink-0" />Каналы продаж: где брать стабильный поток</li>
                      </ul>
                    </div>
                  </div>
                </div>
              </div>
            ) : (
              <p className="text-slate-400">Секция дохода/стратегии отсутствует в данных отчёта.</p>
            )}
          </SectionShell>

          {/* 6) Next step + single CTA */}
          <SectionShell
            id="next-step"
            title="Следующий шаг"
            lead="Вы уже получили базовую оценку потенциала локации и направление по стратегии. Дальше — превратить это в решение: как заходить, как упаковать, какой ценой и на каких каналах забрать спрос."
          >
            <div className="rounded-2xl border border-indigo-500/30 bg-indigo-950/20 p-7 sm:p-8">
              <div className="grid lg:grid-cols-5 gap-6 items-start">
                <div className="lg:col-span-3">
                  <p className="text-[11px] uppercase tracking-[0.22em] text-indigo-200/80">Commercial bridge</p>
                  <h3 className="mt-2 text-2xl sm:text-3xl font-bold tracking-tight text-white">
                    Перевести отчёт в план действий по объекту
                  </h3>
                  <p className="mt-3 text-slate-300 leading-relaxed max-w-2xl">
                    Мы уже посчитали базовый потенциал локации: спросовые магниты, конкуренцию и ориентир по доходу. Следующий шаг — прикладной разбор под вашу модель (owner/operator/investor) и запуск.
                  </p>

                  <div className="mt-5">
                    <p className="text-xs font-semibold text-slate-200 uppercase tracking-[0.18em]">Что вы получите дальше</p>
                    <ul className="mt-3 space-y-2 text-sm text-slate-200">
                      <li className="flex gap-3">
                        <span className="mt-2 w-1.5 h-1.5 rounded-full bg-white/70 shrink-0" />
                        Какая стратегия подходит именно под этот объект — и где она "ломается" без доработок
                      </li>
                      <li className="flex gap-3">
                        <span className="mt-2 w-1.5 h-1.5 rounded-full bg-white/70 shrink-0" />
                        Где реальный потенциал выше/ниже ожиданий: аудитория, каналы, ограничения, конкуренты
                      </li>
                      <li className="flex gap-3">
                        <span className="mt-2 w-1.5 h-1.5 rounded-full bg-white/70 shrink-0" />
                        Как снизить ошибки перед запуском: упаковка, прайс, операционные "узкие места"
                      </li>
                    </ul>
                  </div>
                </div>

                <div className="lg:col-span-2">
                  <div className="rounded-2xl border border-slate-800/70 bg-slate-950/35 p-6">
                    <p className="text-[11px] uppercase tracking-[0.22em] text-slate-500">Один следующий шаг</p>
                    <p className="mt-2 text-sm text-slate-300 leading-relaxed">
                      Если объект рассматривается к запуску/покупке — лучше зафиксировать решение сейчас, пока выводы свежие и можно быстро докрутить модель.
                    </p>

                    <div className="mt-5">
                      <Link
                        href="/connect"
                        className="inline-flex items-center justify-center w-full px-7 py-4 rounded-xl bg-white text-slate-900 font-bold hover:bg-slate-100 transition-colors shadow-lg"
                      >
                        Получить полный отчет локации
                      </Link>
                      <p className="mt-3 text-xs text-slate-500 leading-relaxed">
                        Коротко опишите объект — вернёмся с полным отчётом и рекомендациями по модели запуска.
                      </p>
                    </div>

                    <div className="mt-5 pt-5 border-t border-slate-800/70">
                      <button
                        type="button"
                        onClick={shareLink}
                        disabled={!canShare}
                        className="inline-flex items-center justify-center w-full px-4 py-3 rounded-xl border border-slate-800/70 text-slate-200 hover:text-white hover:border-slate-700 transition-colors disabled:opacity-50 disabled:cursor-not-allowed"
                      >
                        {shareStatus === 'copied' ? 'Ссылка скопирована' : shareStatus === 'failed' ? 'Не удалось скопировать' : 'Скопировать ссылку на отчёт'}
                      </button>
                      <p className="mt-2 text-xs text-slate-600 leading-relaxed">
                        Ссылку можно сохранить или отправить партнёру/инвестору — отчёт откроется по permalink.
                      </p>
                    </div>
                  </div>
                </div>
              </div>
            </div>
          </SectionShell>
        </div>
      </main>
    </div>
  );
}

