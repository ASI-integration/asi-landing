'use client';

import Link from 'next/link';
import type { LocationCommercialReport } from '@/lib/location/client';
import { FIT_LEVEL_LABEL_RU, FIT_LEVEL_COLOR } from '@/lib/location/client';

// ── Helpers ───────────────────────────────────────────────────────────────────

function fmtMeters(m: number): string {
  if (!Number.isFinite(m)) return '—';
  if (m < 1000) return `${Math.round(m / 10) * 10} м`;
  return `${(m / 1000).toFixed(1)} км`;
}

function fmtPct(n: number): string {
  return `${Math.round(n * 100)}%`;
}

function pressureLabel(p: 'low' | 'medium' | 'high'): { label: string; className: string } {
  if (p === 'low') return { label: 'низкое', className: 'text-emerald-300' };
  if (p === 'medium') return { label: 'среднее', className: 'text-amber-300' };
  return { label: 'высокое', className: 'text-rose-300' };
}

function verdictColor(v: string): string {
  if (v === 'strong') return 'text-emerald-300 border-emerald-900/60 bg-emerald-950/30';
  if (v === 'selective') return 'text-amber-300 border-amber-900/60 bg-amber-950/30';
  if (v === 'weak') return 'text-orange-300 border-orange-900/60 bg-orange-950/30';
  return 'text-slate-400 border-slate-800 bg-slate-900/20';
}

// ── Sub-components ─────────────────────────────────────────────────────────────

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

function FlowBar({
  label,
  share,
  color,
  description,
}: {
  label: string;
  share: number;
  color: string;
  description: string;
}) {
  const pct = Math.round(share * 100);
  return (
    <div className="space-y-1.5">
      <div className="flex items-center justify-between">
        <span className="text-sm text-slate-300">{label}</span>
        <span className={`text-sm font-bold ${color}`}>{pct}%</span>
      </div>
      <div className="h-2 rounded-full bg-slate-800 overflow-hidden">
        <div
          className={`h-full rounded-full transition-all duration-700 ${color.replace('text-', 'bg-')}`}
          style={{ width: `${pct}%` }}
        />
      </div>
      <p className="text-[12px] text-slate-500">{description}</p>
    </div>
  );
}

function FitBadge({ level }: { level: 'high' | 'medium' | 'low' | 'poor' }) {
  const color = FIT_LEVEL_COLOR[level];
  const label = FIT_LEVEL_LABEL_RU[level];
  const bg =
    level === 'high'  ? 'bg-emerald-950/40 border-emerald-900/50' :
    level === 'medium' ? 'bg-amber-950/40 border-amber-900/50' :
    level === 'low'   ? 'bg-orange-950/40 border-orange-900/50' :
                        'bg-slate-900/40 border-slate-800';
  return (
    <span className={`inline-flex items-center px-2.5 py-0.5 rounded-full text-[11px] font-semibold border ${bg} ${color}`}>
      {label}
    </span>
  );
}

// ── Main export ───────────────────────────────────────────────────────────────

export function CommercialReportView({ report }: { report: LocationCommercialReport }) {
  const pressure = pressureLabel(report.competition.pressure_level);

  const tocItems = [
    { id: 'flow', label: 'Структура потока' },
    { id: 'format-fit', label: 'Форматная матрица' },
    { id: 'anchors', label: 'Якоря и магниты' },
    { id: 'barriers', label: 'Барьеры и ограничения' },
    { id: 'competition', label: 'Конкуренция' },
    { id: 'recommendation', label: 'Итоговый вывод' },
  ];

  return (
    <div className="min-h-screen bg-slate-950 text-white">
      <div className="max-w-4xl mx-auto px-4 sm:px-6 py-12 sm:py-16 space-y-10">

        {/* ── Header ── */}
        <div>
          <div className="flex items-center gap-2 mb-4 text-xs text-slate-500">
            <Link href="/ru/location-analysis?mode=commercial" className="hover:text-slate-300 transition-colors">
              ← Новый анализ
            </Link>
          </div>
          <p className="text-[11px] uppercase tracking-[0.22em] text-indigo-400 mb-2">
            Пространственный анализ локации · Коммерческий режим
          </p>
          <h1 className="text-3xl sm:text-4xl font-bold tracking-tight text-white leading-tight">
            Детальная пространственная карта локации
          </h1>
          <p className="mt-3 text-slate-400 leading-relaxed max-w-2xl">
            {report.address}
          </p>
          <p className="mt-1 text-[12px] text-slate-600">
            Сформировано: {new Date(report.generated_at_iso).toLocaleString('ru-RU', {
              day: 'numeric', month: 'long', year: 'numeric', hour: '2-digit', minute: '2-digit',
            })}
          </p>
          <p className="mt-3 text-[12px] text-slate-500 border-l-2 border-slate-700 pl-3 max-w-xl">
            Это предварительный интеллектуальный анализ точки на основе открытых пространственных данных.
            Не заменяет физический осмотр и полевое исследование.
          </p>

          {report.spatial ? (
            <div className="mt-4 rounded-xl border border-indigo-900/45 bg-indigo-950/25 px-4 py-3 space-y-2">
              <div className="flex flex-wrap items-center gap-2">
                <span className="text-[11px] uppercase tracking-[0.18em] text-indigo-300/90">Spatial</span>
                <span className="rounded-full border border-indigo-800/60 bg-indigo-950/50 px-2.5 py-0.5 text-xs font-semibold text-indigo-100">
                  tier: {report.spatial.spatial_tier}
                </span>
                {report.spatial.enabled ? (
                  <span className="text-xs text-emerald-300/90">коррекция магнитов включена</span>
                ) : (
                  <span className="text-xs text-slate-500">коррекция магнитов выключена</span>
                )}
                {report.spatial.barrier_penalty_applied ? (
                  <span className="rounded-full border border-amber-900/55 bg-amber-950/35 px-2 py-0.5 text-[11px] font-medium text-amber-200">
                    barrier_penalty_applied
                  </span>
                ) : null}
              </div>
              {report.spatial.corridor_snap_m != null && Number.isFinite(report.spatial.corridor_snap_m) ? (
                <p className="text-[12px] text-slate-400">
                  Коридор до ближайшей оси улицы (proxy): ~{fmtMeters(report.spatial.corridor_snap_m)}
                  {report.spatial.distance_inflation_m > 0
                    ? ` · инфляция дистанции в затухании: +${Math.round(report.spatial.distance_inflation_m)} м`
                    : ''}
                </p>
              ) : null}
              {report.spatial.barrier_kinds.length > 0 ? (
                <p className="text-[11px] text-slate-500">
                  Барьеры в окне данных: {report.spatial.barrier_kinds.join(', ')}
                </p>
              ) : null}
              <p className="text-[12px] text-slate-500 leading-relaxed border-t border-slate-800/60 pt-2 mt-1">
                {report.spatial.geometric_confidence_note_ru}
              </p>
            </div>
          ) : null}

          {/* Overall verdict pill */}
          <div className={`mt-5 inline-flex items-center gap-3 px-5 py-3 rounded-2xl border ${verdictColor(report.formatFit.overallVerdict)}`}>
            <span className="text-sm font-bold">{report.formatFit.overallVerdictLabelRu}</span>
          </div>
        </div>

        {/* ── TOC ── */}
        <div className="rounded-2xl border border-slate-800/70 bg-slate-950/40 p-5">
          <p className="text-[11px] uppercase tracking-[0.22em] text-slate-500 mb-3">Навигация по отчёту</p>
          <nav className="flex flex-wrap gap-x-4 gap-y-2">
            {tocItems.map(item => (
              <a
                key={item.id}
                href={`#${item.id}`}
                className="text-sm text-slate-400 hover:text-white transition-colors"
              >
                {item.label}
              </a>
            ))}
          </nav>
        </div>

        {/* ── FLOW ── */}
        <SectionShell
          id="flow"
          title="Структура потока"
          lead="Не просто количество людей рядом — а какой тип движения преобладает. Это определяет конверсию и формат."
        >
          <div className="space-y-5">
            <FlowBar
              label="Транзитный поток"
              share={report.flow.transitShare}
              color="text-indigo-400"
              description="Люди, проходящие мимо без намерения остановиться"
            />
            <FlowBar
              label="Локально-активный поток"
              share={report.flow.localActiveShare}
              color="text-amber-400"
              description="Жители и работающие рядом — регулярная местная аудитория"
            />
            <FlowBar
              label="Целевой поток"
              share={report.flow.destinationShare}
              color="text-emerald-400"
              description="Люди, приходящие в эту зону с конкретной целью"
            />
          </div>
          <div className="mt-5 p-4 rounded-xl bg-slate-800/30 border border-slate-700/40">
            <p className="text-sm text-slate-200 font-medium">{report.flow.flowConclusion}</p>
          </div>
        </SectionShell>

        {/* ── FORMAT FIT ── */}
        <SectionShell
          id="format-fit"
          title="Форматная матрица"
          lead="Оценка потенциала локации для каждого коммерческого формата — на основе структуры потока, якорных объектов и окружения."
        >
          <div className="space-y-4">
            {report.formatFit.entries.map(entry => (
              <div
                key={entry.format}
                className="rounded-xl border border-slate-800/60 bg-slate-900/20 p-5"
              >
                <div className="flex items-start justify-between gap-3 mb-2">
                  <h3 className="text-base font-semibold text-white">{entry.formatLabelRu}</h3>
                  <FitBadge level={entry.fitLevel} />
                </div>
                <p className="text-sm text-slate-400 mb-3 leading-relaxed">{entry.explanationRu}</p>
                {entry.supportingFactorsRu.length > 0 && (
                  <div className="space-y-1 mb-2">
                    {entry.supportingFactorsRu.map((f, i) => (
                      <div key={i} className="flex items-start gap-2 text-[12px] text-emerald-400">
                        <span className="mt-0.5 shrink-0">+</span>
                        <span>{f}</span>
                      </div>
                    ))}
                  </div>
                )}
                {entry.limitingFactorsRu.length > 0 && (
                  <div className="space-y-1">
                    {entry.limitingFactorsRu.map((f, i) => (
                      <div key={i} className="flex items-start gap-2 text-[12px] text-slate-500">
                        <span className="mt-0.5 shrink-0">−</span>
                        <span>{f}</span>
                      </div>
                    ))}
                  </div>
                )}
              </div>
            ))}
          </div>
        </SectionShell>

        {/* ── ANCHORS ── */}
        <SectionShell
          id="anchors"
          title="Якоря и магниты"
          lead="Ключевые объекты, формирующие спрос в этой локации."
        >
          {report.anchors.length > 0 ? (
            <div className="space-y-2">
              {report.anchors.map((anchor, i) => (
                <div key={i} className="flex items-center justify-between py-2.5 border-b border-slate-800/40 last:border-0">
                  <div className="flex items-center gap-3">
                    <span className="w-7 h-7 flex items-center justify-center rounded-full bg-indigo-950/50 border border-indigo-900/40 text-[12px] font-bold text-indigo-300 shrink-0">
                      {anchor.icon}
                    </span>
                    <span className="text-sm text-slate-200">{anchor.name}</span>
                  </div>
                  <span className="text-[12px] text-slate-500 shrink-0">{fmtMeters(anchor.distance_m)}</span>
                </div>
              ))}
            </div>
          ) : (
            <p className="text-sm text-slate-500">Значимых якорных объектов рядом не обнаружено.</p>
          )}
        </SectionShell>

        {/* ── BARRIERS ── */}
        <SectionShell
          id="barriers"
          title="Барьеры и ограничения"
          lead="Факторы окружения, которые могут снижать потребительскую привлекательность точки."
        >
          {report.barriers.length > 0 ? (
            <ul className="space-y-2">
              {report.barriers.map((b, i) => (
                <li key={i} className="flex items-start gap-3 text-sm text-slate-400">
                  <span className="mt-1 shrink-0 w-1.5 h-1.5 rounded-full bg-orange-500" />
                  {b}
                </li>
              ))}
            </ul>
          ) : (
            <p className="text-sm text-emerald-400">Существенных барьеров по данным не выявлено.</p>
          )}
        </SectionShell>

        {/* ── COMPETITION ── */}
        <SectionShell
          id="competition"
          title="Конкуренция"
        >
          <div className="flex items-center gap-6">
            <div>
              <p className="text-[11px] uppercase tracking-[0.18em] text-slate-500 mb-1">Объектов рядом</p>
              <p className="text-3xl font-bold text-white">{report.competition.competitor_count}</p>
            </div>
            <div>
              <p className="text-[11px] uppercase tracking-[0.18em] text-slate-500 mb-1">Давление</p>
              <p className={`text-2xl font-bold ${pressure.className}`}>{pressure.label}</p>
            </div>
          </div>
        </SectionShell>

        {/* ── RECOMMENDATION ── */}
        <SectionShell
          id="recommendation"
          title="Итоговый вывод"
        >
          <div className={`p-5 rounded-xl border ${verdictColor(report.formatFit.overallVerdict)}`}>
            <p className="text-base font-semibold mb-2">{report.formatFit.overallVerdictLabelRu}</p>
            <p className="text-sm leading-relaxed text-slate-300">{report.recommendation}</p>
          </div>
          <p className="mt-5 text-[12px] text-slate-600 leading-relaxed">
            Анализ выполнен на основе данных OpenStreetMap и пространственного моделирования ASI.
            Результаты отражают вероятный коммерческий потенциал локации, но не заменяют физический осмотр,
            маркетинговое исследование и финансовую модель.
          </p>
        </SectionShell>

        {/* ── Footer CTA ── */}
        <div className="flex flex-col sm:flex-row gap-3 pt-2">
          <Link
            href="/ru/location-analysis?mode=commercial"
            className="inline-flex items-center justify-center px-6 py-3 rounded-xl bg-white text-slate-900 font-bold text-sm hover:bg-slate-100 transition-colors"
          >
            Проверить другую точку
          </Link>
          <Link
            href="/ru"
            className="inline-flex items-center justify-center px-6 py-3 rounded-xl border border-slate-800/70 text-slate-200 text-sm hover:text-white hover:border-slate-700 transition-colors"
          >
            На главную
          </Link>
        </div>

      </div>
    </div>
  );
}
