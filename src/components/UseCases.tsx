'use client';

import { useTranslation } from '@/i18n/useTranslation';

const tagColors: Record<string, string> = {
  'Guest communication': 'bg-blue-50 text-blue-700',
  'Reservation-aware': 'bg-violet-50 text-violet-700',
  'Issue triage': 'bg-orange-50 text-orange-700',
  'Payments': 'bg-emerald-50 text-emerald-700',
  'Multilingual': 'bg-sky-50 text-sky-700',
  'Escalation': 'bg-red-50 text-red-700',
  'Коммуникация': 'bg-blue-50 text-blue-700',
  'Бронирование': 'bg-violet-50 text-violet-700',
  'Триаж': 'bg-orange-50 text-orange-700',
  'Платежи': 'bg-emerald-50 text-emerald-700',
  'Многоязычность': 'bg-sky-50 text-sky-700',
  'Эскалация': 'bg-red-50 text-red-700',
};

export function UseCases() {
  const { t, get } = useTranslation();
  const items = get<{
    scenario: string;
    guest: string;
    asi: string;
    tag: string;
  }[]>('useCases.items') ?? [];

  return (
    <section id="use-cases" className="scroll-mt-24 py-20 px-4 sm:px-6 lg:px-8 bg-slate-50">
      <div className="max-w-5xl mx-auto">
        <h2 className="text-3xl sm:text-4xl font-bold text-slate-900">
          {t('useCases.title')}
        </h2>
        <p className="mt-4 text-lg text-slate-600">
          {t('useCases.subtitle')}
        </p>
        <div className="mt-12 grid grid-cols-1 md:grid-cols-2 gap-6">
          {items.map((item, i) => (
            <div key={i} className="bg-white rounded-2xl border border-slate-200 p-6 flex flex-col gap-4">
              <div className="flex items-center justify-between gap-3">
                <h3 className="text-base font-semibold text-slate-900">{item.scenario}</h3>
                <span className={`flex-shrink-0 text-xs font-medium px-2.5 py-1 rounded-full ${tagColors[item.tag] ?? 'bg-slate-100 text-slate-600'}`}>
                  {item.tag}
                </span>
              </div>
              <div className="space-y-3">
                <div className="flex gap-3">
                  <span className="flex-shrink-0 w-7 h-7 rounded-full bg-slate-100 flex items-center justify-center text-slate-500 text-xs font-semibold mt-0.5">G</span>
                  <p className="text-sm text-slate-600 italic">&ldquo;{item.guest}&rdquo;</p>
                </div>
                <div className="flex gap-3">
                  <span className="flex-shrink-0 w-7 h-7 rounded-full bg-slate-900 flex items-center justify-center text-white text-xs font-semibold mt-0.5">A</span>
                  <p className="text-sm text-slate-700">{item.asi}</p>
                </div>
              </div>
            </div>
          ))}
        </div>
      </div>
    </section>
  );
}
