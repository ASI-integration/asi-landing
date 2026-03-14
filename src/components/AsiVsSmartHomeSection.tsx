'use client';

import { useTranslation } from '@/i18n/useTranslation';

type ComparisonColumn = {
  title: string;
  intro: string;
  bullets: string[];
  resultLine: string;
};

export function AsiVsSmartHomeSection() {
  const { locale, t, get } = useTranslation();

  if (locale !== 'ru') return null;

  const comparison = get<{ smartHome: ComparisonColumn; asi: ComparisonColumn }>('asiVsSmartHome.comparison');
  const keyDiff = get<{ title: string; line1: string; line2: string; line3: string; line4: string }>('asiVsSmartHome.keyDifference');
  const example = get<{ title: string; intro: string; bullets: string[] }>('asiVsSmartHome.example');

  if (!comparison) return null;

  return (
    <section id="asi-vs-smart-home" className="py-20 px-4 sm:px-6 lg:px-8 bg-white">
      <div className="max-w-6xl mx-auto">
        <h2 className="text-3xl sm:text-4xl font-bold text-slate-900">
          {t('asiVsSmartHome.title')}
        </h2>
        <p className="mt-4 text-lg text-slate-600 max-w-3xl">
          {t('asiVsSmartHome.intro1')}
        </p>
        <p className="mt-2 text-lg text-slate-600 max-w-3xl">
          {t('asiVsSmartHome.intro2')}
        </p>
        <p className="mt-2 text-lg text-slate-600 max-w-3xl">
          {t('asiVsSmartHome.intro3')}
        </p>

        <div className="mt-12 grid gap-8 sm:grid-cols-1 lg:grid-cols-2">
          <div className="p-6 bg-slate-50 rounded-xl border border-slate-200 hover:border-slate-300 transition-colors flex flex-col">
            <h3 className="text-xl font-semibold text-slate-900">{comparison.smartHome.title}</h3>
            <p className="mt-3 text-slate-600 text-sm">{comparison.smartHome.intro}</p>
            <ul className="mt-3 list-disc list-inside text-slate-600 text-sm space-y-0.5 flex-1">
              {comparison.smartHome.bullets.map((b, k) => (
                <li key={k}>{String(b).replace(/^[\s•]+/, '').trim()}</li>
              ))}
            </ul>
            <p className="mt-4 pt-3 border-t border-slate-200 text-slate-700 text-sm font-medium">
              {comparison.smartHome.resultLine}
            </p>
          </div>
          <div className="p-6 bg-slate-50 rounded-xl border border-slate-200 hover:border-slate-300 transition-colors flex flex-col">
            <h3 className="text-xl font-semibold text-slate-900">{comparison.asi.title}</h3>
            <p className="mt-3 text-slate-600 text-sm">{comparison.asi.intro}</p>
            <ul className="mt-3 list-disc list-inside text-slate-600 text-sm space-y-0.5 flex-1">
              {comparison.asi.bullets.map((b, k) => (
                <li key={k}>{String(b).replace(/^[\s•]+/, '').trim()}</li>
              ))}
            </ul>
            <p className="mt-4 pt-3 border-t border-slate-200 text-slate-700 text-sm font-medium">
              {comparison.asi.resultLine}
            </p>
          </div>
        </div>

        {keyDiff && (
          <div className="mt-12 p-6 bg-slate-50 rounded-xl border border-slate-200">
            <h3 className="text-xl font-semibold text-slate-900">{keyDiff.title}</h3>
            <p className="mt-3 text-slate-600">{keyDiff.line1}</p>
            <p className="mt-1 text-slate-600">{keyDiff.line2}</p>
            <p className="mt-3 text-slate-600">{keyDiff.line3}</p>
            <p className="mt-1 text-slate-600">{keyDiff.line4}</p>
          </div>
        )}

        {example && (
          <div className="mt-8 p-6 bg-slate-50 rounded-xl border border-slate-200">
            <h3 className="text-xl font-semibold text-slate-900">{example.title}</h3>
            <p className="mt-3 text-slate-600 text-sm">{example.intro}</p>
            <ul className="mt-3 list-disc list-inside text-slate-600 text-sm space-y-0.5">
{example.bullets.map((b, k) => (
              <li key={k}>{String(b).replace(/^[\s•]+/, '').trim()}</li>
            ))}
            </ul>
          </div>
        )}

        <p className="mt-10 text-slate-600 max-w-3xl italic">
          {t('asiVsSmartHome.finalNote')}
        </p>
      </div>
    </section>
  );
}
