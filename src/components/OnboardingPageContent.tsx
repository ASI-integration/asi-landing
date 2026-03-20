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

  const handleSocialConnect = (provider: string) => {
    console.log('Quick connect:', provider);
  };

  const afterBullets = [
    t('onboarding.afterBullet1'),
    t('onboarding.afterBullet2'),
    t('onboarding.afterBullet3'),
    t('onboarding.afterBullet4'),
    t('onboarding.afterBullet5'),
  ];
  const trialBullets = [
    t('onboarding.trialBullet1'),
    t('onboarding.trialBullet2'),
    t('onboarding.trialBullet3'),
    t('onboarding.trialBullet4'),
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
          <p className="mt-2 text-slate-600 text-center text-sm max-w-xl mx-auto">
            {t('cta.trialNote')}
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
            {/* Left: form + quick connection */}
            <div className="lg:col-span-2 space-y-8">
              {/* Quick connection */}
              <div>
                <p className="text-xs font-medium text-slate-500 uppercase tracking-wider mb-3">
                  {t('onboarding.quickConnectHeading')}
                </p>
                <div className="flex flex-col gap-3">
                  <button
                    type="button"
                    onClick={() => handleSocialConnect('google')}
                    className="inline-flex items-center justify-center gap-2 px-5 py-3 border border-slate-300 rounded-lg text-slate-700 font-medium hover:bg-slate-50 hover:border-slate-400 transition-colors text-left"
                  >
                    <svg className="w-5 h-5 shrink-0" viewBox="0 0 24 24">
                      <path
                        fill="#4285F4"
                        d="M22.56 12.25c0-.78-.07-1.53-.2-2.25H12v4.26h5.92c-.26 1.37-1.04 2.53-2.21 3.31v2.77h3.57c2.08-1.92 3.28-4.74 3.28-8.09z"
                      />
                      <path
                        fill="#34A853"
                        d="M12 23c2.97 0 5.46-.98 7.28-2.66l-3.57-2.77c-.98.66-2.23 1.06-3.71 1.06-2.86 0-5.29-1.93-6.16-4.53H2.18v2.84C3.99 20.53 7.7 23 12 23z"
                      />
                      <path
                        fill="#FBBC05"
                        d="M5.84 14.09c-.22-.66-.35-1.36-.35-2.09s.13-1.43.35-2.09V7.07H2.18C1.43 8.55 1 10.22 1 12s.43 3.45 1.18 4.93l2.85-2.22.81-.62z"
                      />
                      <path
                        fill="#EA4335"
                        d="M12 5.38c1.62 0 3.06.56 4.21 1.64l3.15-3.15C17.45 2.09 14.97 1 12 1 7.7 1 3.99 3.47 2.18 7.07l3.66 2.84c.87-2.6 3.3-4.53 6.16-4.53z"
                      />
                    </svg>
                    {t('onboarding.quickConnectGoogle')}
                  </button>
                  <button
                    type="button"
                    onClick={() => handleSocialConnect('vk')}
                    className="inline-flex items-center justify-center gap-2 px-5 py-3 border border-slate-300 rounded-lg text-slate-700 font-medium hover:bg-slate-50 hover:border-slate-400 transition-colors text-left"
                  >
                    <svg className="w-5 h-5 shrink-0" viewBox="0 0 24 24" fill="#07F">
                      <path d="M15.684 0H8.316C1.592 0 0 1.592 0 8.316v7.368C0 22.408 1.592 24 8.316 24h7.368C22.408 24 24 22.408 24 15.684V8.316C24 1.592 22.408 0 15.684 0zm3.692 17.123h-1.744c-.66 0-.862-.525-2.049-1.727-1.033-1-1.49-1.135-1.744-1.135-.356 0-.458.102-.458.593v1.575c0 .424-.135.678-1.253.678-1.846 0-3.896-1.118-5.335-3.202C4.624 10.857 4.03 8.57 4.03 8.096c0-.254.102-.491.593-.491h1.744c.44 0 .61.203.78.677.863 2.49 2.303 4.675 2.896 4.675.22 0 .322-.102.322-.66V9.721c-.068-1.186-.695-1.287-.695-1.71 0-.203.17-.407.44-.407h2.744c.373 0 .508.203.508.643v3.473c0 .372.17.508.271.508.22 0 .407-.136.813-.542 1.254-1.406 2.151-3.574 2.151-3.574.119-.254.322-.491.763-.491h1.744c.525 0 .644.27.525.643-.22 1.017-2.354 4.031-2.354 4.031-.186.305-.254.44 0 .78.186.254.796.779 1.203 1.253.745.847 1.32 1.558 1.473 2.05.17.49-.085.744-.576.744z" />
                    </svg>
                    {t('onboarding.quickConnectVk')}
                  </button>
                  <button
                    type="button"
                    onClick={() => handleSocialConnect('ok')}
                    className="inline-flex items-center justify-center gap-2 px-5 py-3 border border-slate-300 rounded-lg text-slate-700 font-medium hover:bg-slate-50 hover:border-slate-400 transition-colors text-left"
                  >
                    <span className="w-5 h-5 flex items-center justify-center rounded bg-[#ee8208] text-white text-xs font-bold shrink-0">
                      OK
                    </span>
                    {t('onboarding.quickConnectOk')}
                  </button>
                </div>
                <p className="mt-3 text-xs text-slate-500">
                  {t('onboarding.quickConnectNote')}
                </p>
              </div>

              <div className="relative">
                <div className="absolute inset-0 flex items-center">
                  <div className="w-full border-t border-slate-200" />
                </div>
                <div className="relative flex justify-center text-sm">
                  <span className="px-3 bg-white text-slate-500">{t('onboarding.orContacts')}</span>
                </div>
              </div>

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

              <section>
                <h2 className="text-lg font-semibold text-slate-900">
                  {t('onboarding.trialTitle')}
                </h2>
                <p className="mt-2 text-slate-600 text-sm leading-relaxed">
                  {t('onboarding.trialText')}
                </p>
                <BulletList items={trialBullets} />
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
