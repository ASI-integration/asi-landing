'use client';

import { useTranslation } from '@/i18n/useTranslation';

type Module = {
  title: string;
  intro: string[];
  bullets: string[];
  note?: string;
  evalTitle?: string;
  evalBullets?: string[];
};

export function PlatformCapabilities() {
  const { t, get } = useTranslation();
  const modules = get<Module[]>('platformCapabilities.modules') ?? [];

  if (modules.length === 0) return null;

  return (
    <section id="platform-capabilities" className="py-20 px-4 sm:px-6 lg:px-8 bg-white">
      <div className="max-w-6xl mx-auto">
        <h2 className="text-3xl sm:text-4xl font-bold text-slate-900">
          {t('platformCapabilities.title')}
        </h2>
        <p className="mt-4 text-lg text-slate-600 max-w-3xl">
          {t('platformCapabilities.subtitle')}
        </p>
        <div className="mt-12 grid gap-8 sm:grid-cols-1 lg:grid-cols-2">
          {modules.map((mod, i) => (
            <div
              key={i}
              className="p-6 bg-slate-50 rounded-xl border border-slate-200 hover:border-slate-300 transition-colors flex flex-col"
            >
              <h3 className="text-xl font-semibold text-slate-900">{mod.title}</h3>
              <div className="mt-3 space-y-2 text-slate-600 text-sm">
                {mod.intro?.map((line, j) => (
                  <p key={j}>{line}</p>
                ))}
              </div>
              {mod.evalTitle && mod.evalBullets && mod.evalBullets.length > 0 && (
                <div className="mt-3">
                  <p className="text-sm font-medium text-slate-700">{mod.evalTitle}</p>
                  <ul className="mt-1 list-disc list-inside text-slate-600 text-sm space-y-0.5">
                    {mod.evalBullets.map((b, k) => (
                      <li key={k}>{b}</li>
                    ))}
                  </ul>
                </div>
              )}
              <ul className="mt-3 list-disc list-inside text-slate-600 text-sm space-y-0.5 flex-1">
                {mod.bullets?.map((b, k) => (
                  <li key={k}>{b}</li>
                ))}
              </ul>
              {mod.note && (
                <p className="mt-4 pt-3 border-t border-slate-200 text-slate-600 text-sm italic">
                  {mod.note}
                </p>
              )}
            </div>
          ))}
        </div>
      </div>
    </section>
  );
}
