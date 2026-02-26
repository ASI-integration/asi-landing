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
              href="/signup"
              className="inline-flex items-center justify-center px-10 py-4 bg-white text-slate-900 text-lg font-semibold rounded-xl hover:bg-slate-100 transition-all duration-300 shadow-lg shadow-white/10 hover:shadow-xl hover:shadow-white/20 hover:scale-[1.02]"
            >
              {t('hero.ctaPrimary')}
            </Link>
            <Link
              href="/signup"
              className="inline-flex items-center justify-center px-10 py-4 border-2 border-slate-400 text-white text-lg font-semibold rounded-xl hover:bg-white/10 hover:border-slate-300 transition-all duration-300"
            >
              {t('hero.ctaSecondary')}
            </Link>
          </div>
          <Link
            href="/signup"
            className="mt-10 inline-flex items-center justify-center px-10 py-4 bg-white/10 text-white font-medium rounded-xl hover:bg-white/20 transition-all duration-300 border border-slate-600/50 opacity-0"
            style={{ animation: 'fadeIn 0.8s ease-out 0.4s forwards' }}
          >
            {t('hero.getStarted')}
          </Link>
          <p className="mt-4 text-sm text-slate-400">{t('hero.trustCopy')}</p>
          <div className="mt-16 pt-12 border-t border-slate-700/50">
            <p className="text-sm text-slate-500 mb-3">{t('hero.contactLabel')}</p>
            <div className="flex flex-wrap justify-center gap-6 text-slate-400">
              <a
                href="mailto:project.ayfaar@gmail.com"
                className="text-sm hover:text-white transition-colors"
              >
                support@asi.system
              </a>
              <a
                href="https://t.me/asi_support"
                target="_blank"
                rel="noopener noreferrer"
                className="text-sm hover:text-white transition-colors flex items-center gap-1"
              >
                <svg className="w-4 h-4" fill="currentColor" viewBox="0 0 24 24">
                  <path d="M11.944 0A12 12 0 0 0 0 12a12 12 0 0 0 12 12 12 12 0 0 0 12-12A12 12 0 0 0 12 0a12 12 0 0 0-.056 0zm4.962 7.224c.1-.002.321.023.465.14a.506.506 0 0 1 .171.325c.016.093.036.306.02.472-.18 1.898-.962 6.502-1.36 8.627-.168.9-.499 1.201-.82 1.23-.696.065-1.225-.46-1.9-.902-1.056-.693-1.653-1.124-2.678-1.8-1.185-.78-.417-1.21.258-1.91.177-.184 3.247-2.977 3.307-3.23.007-.032.014-.15-.056-.212s-.174-.041-.249-.024c-.106.024-1.793 1.14-5.061 3.345-.48.33-.913.49-1.302.48-.428-.008-1.252-.241-1.865-.44-.752-.245-1.349-.374-1.297-.789.027-.216.325-.437.893-.663 3.498-1.524 5.83-2.529 6.998-3.014 3.332-1.386 4.025-1.627 4.476-1.635z" />
                </svg>
                {t('hero.telegramSupport')}
              </a>
            </div>
          </div>
        </div>
      </div>
    </section>
  );
}
