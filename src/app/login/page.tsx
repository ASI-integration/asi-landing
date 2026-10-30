'use client';

import { useEffect, useState } from 'react';
import { useRouter } from 'next/navigation';
import Link from 'next/link';
import { useTranslation } from '@/i18n/useTranslation';
import { RuEmailCodeSignIn } from '@/components/auth/RuEmailCodeSignIn';
import { safeAuthRedirectPath } from '@/lib/auth/app-url';

export default function LoginPage() {
  const router = useRouter();
  const { t } = useTranslation();
  const [email, setEmail] = useState('');
  const [password, setPassword] = useState('');
  const [loading, setLoading] = useState(false);
  const [error, setError] = useState('');
  const [yandexNotice, setYandexNotice] = useState('');

  useEffect(() => {
    const reason = new URLSearchParams(window.location.search).get('yandex_error');
    if (!reason) return;
    const explanations: Record<string, string> = {
      link_first: 'Сначала войдите в существующий аккаунт ASI по паролю или email-коду. Затем откройте «Настройки» и привяжите Яндекс ID.',
      invalid_state: 'Проверка входа через Яндекс не прошла. Начните вход заново.',
      access_denied: 'Вход через Яндекс отменён. Аккаунт ASI не изменён; можно попробовать снова или использовать другой способ входа.',
      unavailable: 'Яндекс ID пока не настроен. Можно войти по паролю или email-коду.',
      account_not_found: 'Связанный аккаунт ASI не найден. Войдите обычным способом.',
      already_linked: 'Этот Яндекс ID уже привязан к другому аккаунту ASI.',
      link_not_available: 'Привязка Яндекс ID пока недоступна. Повторите позже.',
      link_requires_recent_auth: 'Для привязки Яндекс ID заново подтвердите вход по паролю или email-коду.',
      temporary_failure: 'Яндекс ID временно недоступен. Попробуйте позже или используйте обычный вход.',
    };
    setYandexNotice(explanations[reason] || 'Не удалось завершить вход через Яндекс ID.');
  }, []);

  const handleSubmit = async (e: React.FormEvent) => {
    e.preventDefault();
    setError('');

    if (!email.trim() || !password) {
      setError(t('signup.errorEmailRequired'));
      return;
    }

    setLoading(true);
    try {
      const res = await fetch('/api/auth/login', {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({ email: email.trim(), password }),
      });
      const data = await res.json();
      if (!res.ok) {
        setError(data.error || t('signup.errorGeneric'));
        return;
      }
      const params = new URLSearchParams(window.location.search);
      router.push(safeAuthRedirectPath(params.get('redirect')));
    } catch {
      setError(t('signup.errorGeneric'));
    } finally {
      setLoading(false);
    }
  };

  return (
    <div className="min-h-screen bg-white flex flex-col items-center justify-center px-4 sm:px-6">
      <Link href="/" className="absolute top-6 left-6 text-xl font-bold text-slate-900 tracking-tight">
        ASI
      </Link>

      <div className="w-full max-w-md">
        <h1 className="text-2xl font-bold text-slate-900 tracking-tight text-center">
          {t('login.title')}
        </h1>
        <p className="mt-2 text-center text-sm text-slate-500">
          {t('login.subtitle')}
        </p>

        {yandexNotice && (
          <p role="alert" className="mt-5 rounded-lg border border-amber-200 bg-amber-50 px-4 py-3 text-sm text-amber-900">
            {yandexNotice}
          </p>
        )}

        <RuEmailCodeSignIn redirectPath={typeof window !== 'undefined'
          ? safeAuthRedirectPath(new URLSearchParams(window.location.search).get('redirect')) : '/dashboard'} />

        <form onSubmit={handleSubmit} className="mt-8 space-y-4">
          <div>
            <label htmlFor="email" className="block text-sm font-medium text-slate-700 mb-1">
              {t('signup.emailLabel')}
            </label>
            <input
              id="email"
              type="email"
              value={email}
              onChange={(e) => setEmail(e.target.value)}
              placeholder={t('signup.emailPlaceholder')}
              className="w-full px-4 py-3 border border-slate-300 rounded-lg focus:outline-none focus:ring-2 focus:ring-slate-900 focus:border-transparent"
              disabled={loading}
            />
          </div>

          <div>
            <label htmlFor="password" className="block text-sm font-medium text-slate-700 mb-1">
              {t('signup.passwordLabel')}
            </label>
            <input
              id="password"
              type="password"
              value={password}
              onChange={(e) => setPassword(e.target.value)}
              placeholder={t('signup.passwordPlaceholder')}
              className="w-full px-4 py-3 border border-slate-300 rounded-lg focus:outline-none focus:ring-2 focus:ring-slate-900 focus:border-transparent"
              disabled={loading}
            />
          </div>

          {error && <p className="text-sm text-red-600">{error}</p>}

          <button
            type="submit"
            disabled={loading}
            className="w-full flex items-center justify-center px-6 py-4 bg-slate-900 text-white font-medium rounded-lg hover:bg-slate-800 transition-colors disabled:opacity-70 disabled:cursor-not-allowed"
          >
            {loading ? (
              <span className="flex items-center gap-2">
                <svg className="animate-spin h-5 w-5" viewBox="0 0 24 24">
                  <circle className="opacity-25" cx="12" cy="12" r="10" stroke="currentColor" strokeWidth="4" fill="none" />
                  <path className="opacity-75" fill="currentColor" d="M4 12a8 8 0 018-8V0C5.373 0 0 5.373 0 12h4z" />
                </svg>
                {t('login.submit')}
              </span>
            ) : (
              t('login.submit')
            )}
          </button>

          <p className="text-center text-sm text-slate-500">
            {t('login.signUpPrompt')}{' '}
            <Link
              href={`/connect${typeof window !== 'undefined' && window.location.search ? window.location.search : ''}`}
              className="text-slate-900 font-medium hover:underline"
            >
              {t('cta.startTrial')}
            </Link>
          </p>
        </form>
      </div>
    </div>
  );
}
