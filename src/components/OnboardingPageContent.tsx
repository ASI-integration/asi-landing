'use client';

import { useEffect, useMemo, useRef, useState } from 'react';
import { useRouter } from 'next/navigation';
import { useSearchParams } from 'next/navigation';
import { loadGoogleIdentityServices } from '@/lib/googleIdentity';

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

  const [googleClientId, setGoogleClientId] = useState<string>('');
  const [googleConfigLoading, setGoogleConfigLoading] = useState<boolean>(true);
  const gsiButtonHostRef = useRef<HTMLDivElement | null>(null);
  const debugGoogle = useMemo(() => searchParams.get('debugGoogle') === '1', [searchParams]);

  const selectedPlan = useMemo(() => {
    const plan = (searchParams.get('plan') || '').toLowerCase();
    if (plan === 'small' || plan === 'growth' || plan === 'enterprise') return plan;
    return null;
  }, [searchParams]);

  useEffect(() => {
    let cancelled = false;
    (async () => {
      try {
        setGoogleConfigLoading(true);
        const res = await fetch('/api/public-config', { method: 'GET' });
        const data = (await res.json()) as { googleClientId?: string };
        const clientId = (data.googleClientId || '').trim();
        if (!cancelled) setGoogleClientId(clientId);
        if (debugGoogle) {
          // eslint-disable-next-line no-console
          console.info('[GoogleOAuth][/connect] runtime config loaded', { ok: res.ok, clientIdPresent: Boolean(clientId) });
        }
      } catch (e) {
        if (debugGoogle) {
          // eslint-disable-next-line no-console
          console.info('[GoogleOAuth][/connect] runtime config fetch failed', e);
        }
        if (!cancelled) setGoogleClientId('');
      } finally {
        if (!cancelled) setGoogleConfigLoading(false);
      }
    })();
    return () => {
      cancelled = true;
    };
  }, [debugGoogle]);

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
      if (!googleClientId) {
        setError('Вход через Google сейчас недоступен. Попробуйте позже или используйте email.');
        return;
      }

      await loadGoogleIdentityServices();
      if (!window.google?.accounts?.id) {
        setError('Google авторизация недоступна. Попробуйте позже.');
        return;
      }

      const idToken: string = await new Promise((resolve, reject) => {
        const timer = window.setTimeout(() => reject(new Error('timeout')), 2 * 60 * 1000);
        if (debugGoogle) {
          // eslint-disable-next-line no-console
          console.info('[GoogleOAuth][/connect] GIS loaded, initializing');
        }

        window.google!.accounts!.id!.initialize({
          client_id: googleClientId,
          callback: (resp) => {
            const token = resp?.credential;
            if (token) {
              window.clearTimeout(timer);
              if (debugGoogle) {
                // eslint-disable-next-line no-console
                console.info('[GoogleOAuth][/connect] credential received');
              }
              resolve(token);
            } else {
              window.clearTimeout(timer);
              reject(new Error('no_credential'));
            }
          },
        });

        // Use a real GIS-rendered button under the hood (reliable click → chooser).
        const host = gsiButtonHostRef.current;
        if (host) {
          host.innerHTML = '';
          window.google!.accounts!.id!.renderButton(host, {
            type: 'standard',
            theme: 'outline',
            size: 'large',
            text: mode === 'signup' ? 'signup_with' : 'signin_with',
            shape: 'pill',
            logo_alignment: 'left',
            width: '320',
          });
          const clickable = host.querySelector<HTMLElement>('[role="button"], button, div');
          if (debugGoogle) {
            // eslint-disable-next-line no-console
            console.info('[GoogleOAuth][/connect] renderButton done', { hasClickable: Boolean(clickable) });
          }
          clickable?.click();
          return;
        }

        // Fallback: One Tap prompt (may be blocked by browser settings).
        if (debugGoogle) {
          // eslint-disable-next-line no-console
          console.info('[GoogleOAuth][/connect] no render host, using prompt() fallback');
        }
        window.google!.accounts!.id!.prompt();
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
                disabled={loading || googleConfigLoading}
                className="mt-3 w-full px-5 py-3 rounded-xl bg-slate-900 text-white font-semibold hover:bg-slate-800 disabled:opacity-60 disabled:cursor-not-allowed"
              >
                Войти через Google
              </button>
              <div ref={gsiButtonHostRef} className="sr-only" aria-hidden="true" />
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