'use client';

import { useTranslation } from '@/i18n/useTranslation';

export function EconomicImpactSection() {
  const { t, get } = useTranslation();
  const rawExampleBullets = get<string[]>('economicImpact.exampleBullets') ?? [];
  const exampleBullets = rawExampleBullets.map((item) => String(item).replace(/^[\s•]+/u, '').trim());
  const rawBenefits = get<string[]>('economicImpact.benefits') ?? [];
  const benefits = rawBenefits.map((item) => String(item).replace(/^[\s•]+/u, '').trim());

  return (
    <section id="economic-impact" className="py-20 px-4 sm:px-6 lg:px-8 bg-slate-50">
      <div className="max-w-6xl mx-auto">
        <h2 className="text-3xl sm:text-4xl font-bold text-slate-900">
          {t('economicImpact.title')}
        </h2>
        <p className="mt-4 text-lg text-slate-600">
          {t('economicImpact.intro1')}
        </p>
        <p className="mt-2 text-slate-600">
          {t('economicImpact.intro2')}
        </p>
        <p className="mt-2 text-slate-600">
          {t('economicImpact.intro3')}
        </p>

        <div className="mt-12 grid sm:grid-cols-2 gap-6">
          <div className="p-6 bg-white rounded-xl border border-slate-200">
            <h3 className="text-lg font-semibold text-slate-900">
              {t('economicImpact.exampleTitle')}
            </h3>
            <p className="mt-3 text-slate-600 text-sm">
              {t('economicImpact.exampleText')}
            </p>
            <ul className="mt-2 list-disc list-inside text-slate-600 text-sm space-y-1">
              {exampleBullets.map((item, i) => (
                <li key={i}>{item}</li>
              ))}
            </ul>
            <p className="mt-3 text-slate-600 text-sm font-medium">
              {t('economicImpact.examplePayroll')}
            </p>
          </div>
          <div className="p-6 bg-white rounded-xl border border-slate-200">
            <h3 className="text-lg font-semibold text-slate-900">
              {t('economicImpact.automationTitle')}
            </h3>
            <p className="mt-3 text-slate-600 text-sm">
              {t('economicImpact.automationText1')}
            </p>
            <p className="mt-2 text-slate-600 text-sm">
              {t('economicImpact.automationText2')}
            </p>
          </div>
        </div>

        <div className="mt-8 p-6 bg-white rounded-xl border border-slate-200">
          <h3 className="text-lg font-semibold text-slate-900">
            {t('economicImpact.benefitsTitle')}
          </h3>
          <ul className="mt-3 list-disc list-inside space-y-2 text-slate-600 text-sm">
            {benefits.map((item, i) => (
              <li key={i}>{item}</li>
            ))}
          </ul>
        </div>

        <p className="mt-6 text-sm text-slate-600 italic border-l-4 border-slate-300 pl-4 bg-white/80 py-2 rounded-r">
          {t('economicImpact.note')}
        </p>
      </div>
    </section>
  );
}
