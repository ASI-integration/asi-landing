'use client';

import { Fragment } from 'react';
import { useTranslation } from '@/i18n/useTranslation';

const FLOW_ICONS = ['📡', '🔄', '⚙️', '🏠', '📊'];

export function ArchitectureSection() {
  const { t, get } = useTranslation();
  const steps = get<{ title: string; desc: string }[]>('architecture.steps') ?? [];

  return (
    <section id="architecture" className="py-20 px-4 sm:px-6 lg:px-8 bg-slate-50">
      <div className="max-w-6xl mx-auto">
        <h2 className="text-3xl sm:text-4xl font-bold text-slate-900">
          {t('architecture.title')}
        </h2>
        <p className="mt-4 text-lg text-slate-600">
          {t('architecture.subtitle')}
        </p>
        <div className="mt-12 flex flex-col lg:flex-row lg:items-start lg:justify-between">
          {steps.map((step, i) => (
            <Fragment key={i}>
              <div className="flex flex-col items-center text-center lg:text-left lg:items-start min-w-0 flex-1">
                <span className="flex-shrink-0 w-12 h-12 rounded-full bg-white border border-slate-200 flex items-center justify-center text-xl shadow-sm">
                  {FLOW_ICONS[i] ?? '•'}
                </span>
                <h3 className="mt-3 text-base font-semibold text-slate-900">
                  {step.title}
                </h3>
                <p className="mt-1 text-sm text-slate-600">
                  {step.desc}
                </p>
              </div>
              {i < steps.length - 1 && (
                <div
                  className="hidden lg:flex flex-shrink-0 w-4 h-0.5 bg-slate-300 self-center mt-[-2.5rem]"
                  aria-hidden
                />
              )}
              {i < steps.length - 1 && (
                <div
                  className="lg:hidden w-0.5 h-4 bg-slate-300 self-center my-1"
                  aria-hidden
                />
              )}
            </Fragment>
          ))}
        </div>
        <p className="mt-12 text-slate-600 max-w-3xl">
          {t('architecture.footer')}
        </p>
      </div>
    </section>
  );
}
