'use client';

import { useTranslation } from '@/i18n/useTranslation';

export function AsiDecisionMaking() {
  const { locale, t, get } = useTranslation();

  if (locale !== 'ru') return null;

  const evalBullets = get<string[]>('asiDecisionMaking.evalBullets') ?? [];
  const systemCanBullets = get<string[]>('asiDecisionMaking.systemCanBullets') ?? [];

  return (
    <section id="asi-decision-making" className="py-20 px-4 sm:px-6 lg:px-8 bg-white">
      <div className="max-w-6xl mx-auto">
        <h2 className="text-3xl sm:text-4xl font-bold text-slate-900">
          {t('asiDecisionMaking.title')}
        </h2>
        <p className="mt-4 text-lg text-slate-600 max-w-3xl">
          {t('asiDecisionMaking.intro')}
        </p>
        <div className="mt-3">
          <p className="text-sm font-medium text-slate-700">{t('asiDecisionMaking.evalLabel')}</p>
          <ul className="mt-1 list-disc list-inside text-slate-600 text-sm space-y-0.5">
            {evalBullets.map((b, k) => (
              <li key={k}>{String(b).replace(/^[\s•]+/u, '').trim()}</li>
            ))}
          </ul>
        </div>
        <p className="mt-4 text-slate-600 max-w-3xl">
          {t('asiDecisionMaking.outro')}
        </p>
        <div className="mt-12">
          <div className="p-6 bg-slate-50 rounded-xl border border-slate-200 hover:border-slate-300 transition-colors flex flex-col max-w-3xl">
            <h3 className="text-xl font-semibold text-slate-900">{t('asiDecisionMaking.systemCanLabel')}</h3>
            <ul className="mt-3 list-disc list-inside text-slate-600 text-sm space-y-0.5">
              {systemCanBullets.map((b, k) => (
                <li key={k}>{String(b).replace(/^[\s•]+/u, '').trim()}</li>
              ))}
            </ul>
            <p className="mt-4 pt-3 border-t border-slate-200 text-slate-600 text-sm italic">
              {t('asiDecisionMaking.explanation')}
            </p>
          </div>
        </div>
      </div>
    </section>
  );
}
