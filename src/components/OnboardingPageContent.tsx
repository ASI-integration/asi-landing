'use client';

import { useState } from 'react';
import { useRouter } from 'next/navigation';
import Link from 'next/link';
import { useTranslation } from '@/i18n/useTranslation';

const inputClass =
  'w-full px-4 py-3 border border-slate-300 rounded-lg focus:outline-none focus:ring-2 focus:ring-slate-900 focus:border-transparent';

function BulletList({ items }: { items: string[] }) {
  return (
    <ul className="mt-3 space-y-1.5 text-slate-600 text-sm leading-relaxed">
      {items.map((item, i) => (
        <li key={i} className="flex gap-2">
          <span className="text-slate-400 shrink-0">•</span>
          <span>{item}</span>
        </li>
      ))}
    </ul>
  );
}

export function OnboardingPageContent() {
  const router = useRouter();
  const { t } = useTranslation();
  const [name, setName] = useState('');
  const [email, setEmail] = useState('');
  const [phone, setPhone] = useState('');
  const [telegram, setTelegram] = useState('');
  const [objectsCount, setObjectsCount] = useState('');
  const [comment, setComment] = useState('');
  const [loading, setLoading] = useState(false);
  const [error, setError] = useState('');

  const isValidEmail = (v: string) => /^[^\s@]+@[^\s@]+\.[^\s@]+$/.test(v);

  const handleSubmit = async (e: React.FormEvent) => {
    e.preventDefault();
    setError('');

    if (!name.trim()) {
      setError(t('onboarding.errorNameRequired'));
      return;
    }
    if (!email.trim()) {
      setError(t('onboarding.errorEmailRequired'));
      return;
    }
    if (!isValidEmail(email)) {
      setError(t('onboarding.errorEmailInvalid'));
      return;
    }

    setLoading(true);
    try {
      const res = await fetch('/api/auth/onboarding', {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({
          name: name.trim(),
          email: email.trim(),
          phone: phone.trim() || undefined,
          telegram: telegram.trim() || undefined,
          objectsCount: objectsCount.trim() || undefined,
          comment: comment.trim() || undefined,
        }),
      });
      const data = await res.json();
      if (!res.ok) {
        setError(
          data.error === 'Email already registered'
            ? t('onboarding.errorEmailExists')
            : data.error || t('onboarding.errorGeneric')
        );
        return;
      }
      router.push('/dashboard');
    } catch {
      setError(t('onboarding.errorGeneric'));
    } finally {
      setLoading(false);
    }
  };

  const afterBullets = [
    t('onboarding.afterBullet1'),
    t('onboarding.afterBullet2'),
    t('onboarding.afterBullet3'),
    t('onboarding.afterBullet4'),
    t('onboarding.afterBullet5'),
  ];
  const forWhomBullets = [
    t('onboarding.forWhomBullet1'),
    t('onboarding.forWhomBullet2'),
    t('onboarding.forWhomBullet3'),
    t('onboarding.forWhomBullet4'),
    t('onboarding.forWhomBullet5'),
    t('onboarding.forWhomBullet6'),
  ];
  const trustPills = [
    t('onboarding.trustPill1'),
    t('onboarding.trustPill2'),
    t('onboarding.trustPill3'),
  ];

  return (
    <div className="min-h-screen bg-white flex flex-col">
      <Link
        href="/"
        className="absolute top-6 left-6 text-xl font-bold text-slate-900 tracking-tight z-10"
      >
        ASI
      </Link>

      <div className="flex-1 flex items-start justify-center px-4 sm:px-6 pt-16 pb-20">
        <div className="w-full max-w-5xl">
          <h1 className="text-2xl sm:text-3xl font-bold text-slate-900 tracking-tight text-center">
            {t('onboarding.pageTitle')}
          </h1>
          <p className="mt-3 text-slate-600 text-center text-sm sm:text-base max-w-xl mx-auto">
            {t('onboarding.subtitle')}
          </p>

          {/* Trust pills above the form */}
          <div className="mt-8 flex flex-wrap justify-center gap-2 sm:gap-3">
            {trustPills.map((text, i) => (
              <span
                key={i}
                className="inline-flex items-center px-3.5 py-1.5 rounded-full text-xs font-medium text-slate-600 bg-slate-100 border border-slate-200/80"
              >
                {text}
              </span>
            ))}
          </div>

          <div className="mt-10 grid grid-cols-1 lg:grid-cols-5 gap-10 lg:gap-12">
            {/* Left: form */}
            <div className="lg:col-span-2 space-y-8">
              <form onSubmit={handleSubmit} className="space-y-4">
                <div>
                  <label htmlFor="name" className="block text-sm font-medium text-slate-700 mb-1">
                    {t('onboarding.nameLabel')}
                  </label>
                  <input
                    id="name"
                    type="text"
                    value={name}
                    onChange={(e) => setName(e.target.value)}
                    placeholder={t('onboarding.namePlaceholder')}
                    className={inputClass}
                    disabled={loading}
                  />
                </div>
                <div>
                  <label htmlFor="email" className="block text-sm font-medium text-slate-700 mb-1">
                    {t('onboarding.emailLabel')}
                  </label>
                  <input
                    id="email"
                    type="email"
                    value={email}
                    onChange={(e) => setEmail(e.target.value)}
                    placeholder={t('onboarding.emailPlaceholder')}
                    className={inputClass}
                    disabled={loading}
                  />
                </div>
                <div>
                  <label htmlFor="phone" className="block text-sm font-medium text-slate-700 mb-1">
                    {t('onboarding.phoneLabel')}{' '}
                    <span className="text-slate-400 font-normal">{t('onboarding.optional')}</span>
                  </label>
                  <input
                    id="phone"
                    type="tel"
                    value={phone}
                    onChange={(e) => setPhone(e.target.value)}
                    placeholder={t('onboarding.phonePlaceholder')}
                    className={inputClass}
                    disabled={loading}
                  />
                </div>
                <div>
                  <label htmlFor="telegram" className="block text-sm font-medium text-slate-700 mb-1">
                    {t('onboarding.telegramLabel')}{' '}
                    <span className="text-slate-400 font-normal">{t('onboarding.optional')}</span>
                  </label>
                  <input
                    id="telegram"
                    type="text"
                    value={telegram}
                    onChange={(e) => setTelegram(e.target.value)}
                    placeholder={t('onboarding.telegramPlaceholder')}
                    className={inputClass}
                    disabled={loading}
                  />
                </div>
                <p className="text-xs text-slate-500 -mt-1">
                  {t('onboarding.contactPreferred')}
                </p>
                <p className="text-xs text-slate-500">
                  {t('onboarding.contactsHelperNote')}
                </p>
                <div>
                  <label htmlFor="objectsCount" className="block text-sm font-medium text-slate-700 mb-1">
                    {t('onboarding.objectsCountLabel')}
                  </label>
                  <input
                    id="objectsCount"
                    type="text"
                    inputMode="numeric"
                    value={objectsCount}
                    onChange={(e) => setObjectsCount(e.target.value)}
                    placeholder={t('onboarding.objectsCountPlaceholder')}
                    className={inputClass}
                    disabled={loading}
                  />
                </div>
                <div>
                  <label htmlFor="comment" className="block text-sm font-medium text-slate-700 mb-1">
                    {t('onboarding.commentLabel')}{' '}
                    <span className="text-slate-400 font-normal">{t('onboarding.optional')}</span>
                  </label>
                  <textarea
                    id="comment"
                    rows={3}
                    value={comment}
                    onChange={(e) => setComment(e.target.value)}
                    placeholder={t('onboarding.commentPlaceholder')}
                    className={`${inputClass} resize-none`}
                    disabled={loading}
                  />
                </div>

                {error && <p className="text-sm text-red-600">{error}</p>}

                <button
                  type="submit"
                  disabled={loading}
                  className="w-full flex items-center justify-center px-6 py-4 bg-slate-900 text-white font-semibold rounded-xl hover:bg-slate-800 transition-colors disabled:opacity-70 disabled:cursor-not-allowed"
                >
                  {loading ? (
                    <span className="flex items-center gap-2">
                      <svg className="animate-spin h-5 w-5" viewBox="0 0 24 24">
                        <circle className="opacity-25" cx="12" cy="12" r="10" stroke="currentColor" strokeWidth="4" fill="none" />
                        <path className="opacity-75" fill="currentColor" d="M4 12a8 8 0 018-8V0C5.373 0 0 5.373 0 12h4z" />
                      </svg>
                      {t('cta.startTrial')}
                    </span>
                  ) : (
                    t('cta.startTrial')
                  )}
                </button>
                <p className="text-center text-xs text-slate-500">
                  {t('onboarding.ctaSecondary')}
                </p>
              </form>
            </div>

            {/* Right: onboarding explanation and trust blocks */}
            <div className="lg:col-span-3 space-y-8 lg:pt-0 pt-6 border-t border-slate-200 lg:border-t-0 lg:pl-8 lg:border-l border-slate-200">
              <section>
                <h2 className="text-lg font-semibold text-slate-900">
                  {t('onboarding.afterTitle')}
                </h2>
                <p className="mt-2 text-slate-600 text-sm leading-relaxed">
                  {t('onboarding.afterText')}
                </p>
                <BulletList items={afterBullets} />
              </section>

              <section className="p-4 sm:p-5 bg-slate-50 rounded-xl border border-slate-200">
                <h2 className="text-lg font-semibold text-slate-900">
                  {t('onboarding.financeTitle')}
                </h2>
                <p className="mt-2 text-slate-600 text-sm leading-relaxed">
                  {t('onboarding.financeText')}
                </p>
                <p className="mt-3 text-slate-500 text-xs italic">
                  {t('onboarding.financeNote')}
                </p>
              </section>

              <section>
                <h2 className="text-lg font-semibold text-slate-900">
                  {t('onboarding.forWhomTitle')}
                </h2>
                <BulletList items={forWhomBullets} />
              </section>
            </div>
          </div>

          <p className="mt-12 text-center text-xs text-slate-500 max-w-xl mx-auto">
            {t('onboarding.trustNoteBottom')}
          </p>
        </div>
      </div>
    </div>
  );
}
