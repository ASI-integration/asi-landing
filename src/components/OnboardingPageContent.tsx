'use client';

import { useEffect, useMemo, useState } from 'react';
import { useRouter } from 'next/navigation';
import { useSearchParams } from 'next/navigation';

type PricingPlan = 'small' | 'growth' | 'enterprise';
const SELECTED_PLAN_STORAGE_KEY = 'asi.selectedPlan';

export default function OnboardingPageContent() {
  const router = useRouter();
  const [loading, setLoading] = useState(false);
  const [mode, setMode] = useState<'signup' | 'login'>('signup');
  const [email, setEmail] = useState('');
  const [password, setPassword] = useState('');
  const [error, setError] = useState('');
  const searchParams = useSearchParams();

  const selectedPlan = useMemo(() => {
    const plan = (searchParams.get('plan') || '').toLowerCase();
    if (plan === 'small' || plan === 'growth' || plan === 'enterprise') return plan;
    return null;
  }, [searchParams]);

  useEffect(() => {
    if (!selectedPlan) return;
    try {
      window.localStorage.setItem(SELECTED_PLAN_STORAGE_KEY, selectedPlan);
    } catch {
      // ignore
    }
  }, [selectedPlan]);

  const selectedPlanValue = useMemo((): PricingPlan => {
    if (selectedPlan) return selectedPlan;
    try {
      const stored = window.localStorage.getItem(SELECTED_PLAN_STORAGE_KEY);
      if (stored === 'small' || stored === 'growth' || stored === 'enterprise') return stored;
    } catch {
      // ignore
    }
    return 'small';
  }, [selectedPlan]);

  const selectedPlanLabel = useMemo(() => {
    const plan = selectedPlanValue;
    if (plan === 'small') return 'Базовый';
    if (plan === 'growth') return 'Масштабирование';
    return 'Крупный портфель';
  }, [selectedPlanValue]);

  const planAfterTrial = useMemo(() => {
    if (selectedPlanValue === 'small') return '12 900 ₽ / объект / месяц';
    if (selectedPlanValue === 'growth') return '8 900 ₽ / объект / месяц';
    return '6 900 ₽ / объект / месяц';
  }, [selectedPlanValue]);

  const handleEmailAuth = async (e: React.FormEvent) => {
    e.preventDefault();
    setError('');
    if (!email.trim() || !password) {
      setError('Укажите email и пароль.');
      return;
    }

    setLoading(true);
    try {
      const endpoint = mode === 'signup' ? '/api/auth/signup' : '/api/auth/login';
      const res = await fetch(endpoint, {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({ email: email.trim(), password, plan: selectedPlanValue }),
      });
      const data = await res.json();
      if (!res.ok) {
        setError(data.error || 'Ошибка авторизации.');
        return;
      }
      router.push('/dashboard');
    } catch {
      setError('Ошибка сети. Попробуйте ещё раз.');
    } finally {
      setLoading(false);
    }
  };

  const handleGoogle = async () => {
    setError('');
    setLoading(true);
    try {
      // Minimal GIS button without heavy SDK:
      // We open Google's "One Tap" style flow later; for now we use a popup to accounts.google.com
      // and rely on an id_token returned via postMessage from a tiny redirect page.
      //
      // To keep this v1 minimal, we fall back to email signup if popup blocked.
      const w = 520;
      const h = 640;
      const left = Math.max(0, Math.round(window.screenX + (window.outerWidth - w) / 2));
      const top = Math.max(0, Math.round(window.screenY + (window.outerHeight - h) / 2));
      const popup = window.open(
        `/connect/google?plan=${encodeURIComponent(selectedPlanValue)}`,
        'asi_google_auth',
        `width=${w},height=${h},left=${left},top=${top}`
      );
      if (!popup) {
        setError('Попап заблокирован. Разрешите попапы или используйте email.');
        return;
      }

      const idToken: string = await new Promise((resolve, reject) => {
        const timer = window.setTimeout(() => reject(new Error('timeout')), 2 * 60 * 1000);
        function onMsg(ev: MessageEvent) {
          if (ev?.data?.type === 'asi_google_id_token' && typeof ev.data.idToken === 'string') {
            window.clearTimeout(timer);
            window.removeEventListener('message', onMsg);
            resolve(ev.data.idToken);
          }
        }
        window.addEventListener('message', onMsg);
      });

      const res = await fetch('/api/auth/google', {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({ idToken, plan: selectedPlanValue }),
      });
      const data = await res.json();
      if (!res.ok) {
        setError(data.error || 'Ошибка входа через Google.');
        return;
      }
      router.push('/dashboard');
    } catch {
      setError('Не удалось войти через Google. Используйте email.');
    } finally {
      setLoading(false);
    }
  };

  return (
    <div className="min-h-screen bg-white flex items-center justify-center px-4 py-10">
      <div className="w-full max-w-2xl">
        <div className="bg-slate-50 border border-slate-200 rounded-2xl p-6 sm:p-8 shadow-sm">
          <h1 className="text-2xl sm:text-3xl font-bold text-slate-900 tracking-tight">
            Начать 7‑дневный тест
          </h1>
          <p className="mt-2 text-slate-600">
            Вы выбрали тариф <span className="font-semibold text-slate-900">{selectedPlanLabel}</span>. После регистрации вы получите доступ к кабинету и сможете подключить каналы.
          </p>

          <div className="mt-6 grid sm:grid-cols-3 gap-3">
            <div className="bg-white rounded-xl border border-slate-200 p-4">
              <p className="text-sm font-medium text-slate-900">Тариф</p>
              <p className="mt-1 text-sm text-slate-600">{selectedPlanLabel}</p>
            </div>
            <div className="bg-white rounded-xl border border-slate-200 p-4">
              <p className="text-sm font-medium text-slate-900">Пробный период</p>
              <p className="mt-1 text-sm text-slate-600">7 дней</p>
            </div>
            <div className="bg-white rounded-xl border border-slate-200 p-4">
              <p className="text-sm font-medium text-slate-900">После теста</p>
              <p className="mt-1 text-sm text-slate-600">{planAfterTrial}</p>
            </div>
          </div>

          <div className="mt-8 grid sm:grid-cols-2 gap-6">
            <div className="bg-white rounded-2xl border border-slate-200 p-5">
              <p className="text-sm font-semibold text-slate-900">Быстрый вход</p>
              <button
                type="button"
                onClick={handleGoogle}
                disabled={loading}
                className="mt-3 w-full px-5 py-3 rounded-xl bg-slate-900 text-white font-semibold hover:bg-slate-800 disabled:opacity-60"
              >
                Войти через Google
              </button>
              <p className="mt-3 text-xs text-slate-500">
                Мы создадим рабочее пространство и запустим 7‑дневный тест.
              </p>
            </div>

            <div className="bg-white rounded-2xl border border-slate-200 p-5">
              <div className="flex items-center justify-between">
                <p className="text-sm font-semibold text-slate-900">Email</p>
                <div className="flex items-center gap-2">
                  <button
                    type="button"
                    className={`text-xs px-3 py-1.5 rounded-lg border ${
                      mode === 'signup' ? 'bg-slate-900 text-white border-slate-900' : 'bg-white text-slate-700 border-slate-200'
                    }`}
                    onClick={() => setMode('signup')}
                    disabled={loading}
                  >
                    Регистрация
                  </button>
                  <button
                    type="button"
                    className={`text-xs px-3 py-1.5 rounded-lg border ${
                      mode === 'login' ? 'bg-slate-900 text-white border-slate-900' : 'bg-white text-slate-700 border-slate-200'
                    }`}
                    onClick={() => setMode('login')}
                    disabled={loading}
                  >
                    Вход
                  </button>
                </div>
              </div>

              <form onSubmit={handleEmailAuth} className="mt-4 space-y-3">
                <div>
                  <label className="block text-xs font-medium text-slate-600">Email</label>
                  <input
                    value={email}
                    onChange={(e) => setEmail(e.target.value)}
                    type="email"
                    className="mt-1 w-full px-4 py-3 rounded-xl border border-slate-200 focus:outline-none focus:ring-2 focus:ring-slate-900"
                    placeholder="you@company.ru"
                    disabled={loading}
                  />
                </div>
                <div>
                  <label className="block text-xs font-medium text-slate-600">Пароль</label>
                  <input
                    value={password}
                    onChange={(e) => setPassword(e.target.value)}
                    type="password"
                    className="mt-1 w-full px-4 py-3 rounded-xl border border-slate-200 focus:outline-none focus:ring-2 focus:ring-slate-900"
                    placeholder="Минимум 6 символов"
                    disabled={loading}
                  />
                </div>
                {error && <p className="text-sm text-red-600">{error}</p>}
                <button
                  type="submit"
                  disabled={loading}
                  className="w-full px-5 py-3 rounded-xl bg-white border border-slate-900 text-slate-900 font-semibold hover:bg-slate-50 disabled:opacity-60"
                >
                  {mode === 'signup' ? 'Создать аккаунт и начать тест' : 'Войти и продолжить'}
                </button>
              </form>
            </div>
          </div>
        </div>
      </div>
    </div>
  );
}