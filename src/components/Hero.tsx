'use client';

import Link from 'next/link';
import { useTranslation } from '@/i18n/useTranslation';

export function Hero() {
  const { t } = useTranslation();

  return (
    <section className="relative min-h-[90vh] flex items-center justify-center overflow-hidden bg-slate-900">
      <div
        className="absolute inset-0 opacity-30"
        style={{
          background: 'radial-gradient(ellipse 80% 50% at 50% 0%, rgba(148, 163, 184, 0.15), transparent)',
        }}
      />
      <div
        className="absolute inset-0 opacity-[0.03]"
        style={{
          backgroundImage: `
            linear-gradient(rgba(255,255,255,0.1) 1px, transparent 1px),
            linear-gradient(90deg, rgba(255,255,255,0.1) 1px, transparent 1px)
          `,
          backgroundSize: '60px 60px',
        }}
      />
      <div className="relative z-10 pt-24 pb-20 px-4 sm:px-6 lg:px-8 w-full">
        <div className="max-w-4xl mx-auto text-center">
          <h1
            className="text-4xl sm:text-5xl lg:text-6xl font-bold text-white tracking-tight leading-tight opacity-0"
            style={{ animation: 'fadeIn 0.8s ease-out forwards' }}
          >
            {t('hero.headline')}
          </h1>
          <p
            className="mt-6 text-xl sm:text-2xl text-slate-300 max-w-2xl mx-auto opacity-0"
            style={{ animation: 'fadeIn 0.8s ease-out 0.15s forwards' }}
          >
            {t('hero.subheadline')}
          </p>
          <div
            className="mt-10 flex flex-col sm:flex-row gap-4 justify-center opacity-0"
            style={{ animation: 'fadeIn 0.8s ease-out 0.3s forwards' }}
          >
            <Link
              href="/connect"
              className="inline-flex items-center justify-center px-10 py-4 bg-white text-slate-900 text-lg font-semibold rounded-xl hover:bg-slate-100 transition-all duration-300 shadow-lg shadow-white/10 hover:shadow-xl hover:shadow-white/20 hover:scale-[1.02]"
            >
              {t('cta.startTrial')}
            </Link>
            <Link
              href="#how-it-works"
              className="inline-flex items-center justify-center px-10 py-4 border-2 border-slate-400 text-white text-lg font-semibold rounded-xl hover:bg-white/10 hover:border-slate-300 transition-all duration-300"
            >
              {t('hero.ctaSecondary')}
            </Link>
          </div>
        </div>
      </div>
    </section>
  );
}
