'use client';

import { useEffect, useMemo, useRef, useState } from 'react';
import { useRouter } from 'next/navigation';
import { useSearchParams } from 'next/navigation';
import { loadGoogleIdentityServices } from '@/lib/googleIdentity';
import { readResponseJson } from '@/lib/safeResponseJson';
import { productSupportEmail } from '@/config/contact';

type PublicConfigResponse = {
  googleClientId?: string;
  googleOAuthConfigured?: boolean;
  googleOAuthEnv?: string;
  googleOAuthMode?: 'redirect' | 'gis' | 'disabled';
};

const emptyPublicConfig: PublicConfigResponse = {};

type PricingPlan = 'small' | 'growth' | 'enterprise';
const SELECTED_PLAN_STORAGE_KEY = 'asi.selectedPlan';

function safeRedirectPath(value: string | null): string {
  if (!value || !value.startsWith('/') || value.startsWith('//')) return '/dashboard';
  return value;
}

export default function OnboardingPageContent() {
  const router = useRouter();
  const [loading, setLoading] = useState(false);
  const [mode, setMode] = useState<'signup' | 'login'>('signup');
  const [email, setEmail] = useState('');
  const [password, setPassword] = useState('');
  const [error, setError] = useState('');
  const [googleStatus, setGoogleStatus] = useState<string>('');
  const searchParams = useSearchParams();
  const isMountedRef = useRef(true);

  // OAuth redirect flow depends on SERVER env (client id + secret), not on build-time NEXT_PUBLIC_*.
  // We must fetch runtime config to avoid client/server env mismatches and misleading enabled state.
  const [googleOAuthConfigured, setGoogleOAuthConfigured] = useState<boolean>(false);
  /** Server hint: ready | missing_client_id | missing_client_secret — for UI/debug only. */
  const [googleOAuthEnv, setGoogleOAuthEnv] = useState<string>('');
  const [googleOAuthMode, setGoogleOAuthMode] = useState<'redirect' | 'gis' | 'disabled'>('disabled');
  const [googleConfigLoading, setGoogleConfigLoading] = useState<boolean>(true);
  // Kept only for GIS fallback/debug; not used for enablement.
  const [googleClientId, setGoogleClientId] = useState<string>(() => (process.env.NEXT_PUBLIC_GOOGLE_CLIENT_ID || '').trim());
  const gsiButtonHostRef = useRef<HTMLDivElement | null>(null);
  const debugGoogle = useMemo(() => searchParams.get('debugGoogle') === '1', [searchParams]);
  const afterAuthRedirect = useMemo(
    () => safeRedirectPath(searchParams.get('redirect')),
    [searchParams],
  );
  const publicConfigFetchAttemptedRef = useRef(false);

  useEffect(() => {
    isMountedRef.current = true;
    return () => {
      isMountedRef.current = false;
    };
  }, []);

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
        const controller = new AbortController();
        const timeoutId = window.setTimeout(() => controller.abort(), 5000);
        let res: Response;
        try {
          res = await fetch('/api/public-config', { method: 'GET', signal: controller.signal });
        } finally {
          window.clearTimeout(timeoutId);
        }
        const data = await readResponseJson(res, emptyPublicConfig);
        const clientId = (data.googleClientId || '').trim();
        const configured = Boolean(data.googleOAuthConfigured);
        const envHint = typeof data.googleOAuthEnv === 'string' ? data.googleOAuthEnv : '';
        const mode = data.googleOAuthMode === 'redirect' || data.googleOAuthMode === 'gis' || data.googleOAuthMode === 'disabled'
          ? data.googleOAuthMode
          : (configured ? 'redirect' : 'disabled');
        if (!cancelled && isMountedRef.current) {
          setGoogleClientId(clientId);
          setGoogleOAuthConfigured(configured);
          setGoogleOAuthEnv(envHint);
          setGoogleOAuthMode(mode);
        }
        if (debugGoogle) {
          // eslint-disable-next-line no-console
          console.info('[GoogleOAuth][/connect] runtime config loaded', {
            ok: res.ok,
            clientIdPresent: Boolean(clientId),
            oauthConfigured: configured,
            googleOAuthEnv: envHint || undefined,
            mode,
          });
        }
      } catch (e) {
        if (debugGoogle) {
          // eslint-disable-next-line no-console
          console.info('[GoogleOAuth][/connect] runtime config fetch failed', e);
        }
        if (!cancelled && isMountedRef.current) {
          setGoogleClientId('');
          setGoogleOAuthConfigured(false);
          setGoogleOAuthEnv('');
          setGoogleOAuthMode('disabled');
        }
      } finally {
        // Always clear the loading flag once the request settles.
        // Guard only against true unmount, not effect re-runs.
        if (isMountedRef.current) setGoogleConfigLoading(false);
      }
    })();
    return () => {
      cancelled = true;
    };
  }, [debugGoogle]);

  const googleErrorParam = useMemo(() => (searchParams.get('google_error') || '').trim(), [searchParams]);
  useEffect(() => {
    if (!googleErrorParam) return;
    if (googleErrorParam === 'not_configured') {
      setError('Вход через Google сейчас недоступен (не настроено). Используйте email.');
    } else if (googleErrorParam === 'session_not_configured') {
      setError('Вход через Google временно недоступен (сессия на сервере не настроена). Используйте email.');
    } else if (googleErrorParam === 'bad_state') {
      setError('Не удалось подтвердить вход через Google. Попробуйте ещё раз.');
    } else if (googleErrorParam === 'missing_params') {
      setError('Не удалось начать вход через Google. Попробуйте ещё раз.');
    } else {
      setError('Вход через Google не удался. Используйте email.');
    }
  }, [googleErrorParam]);

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

  const googleReady = googleOAuthConfigured && !googleConfigLoading;
  const demoMailto = useMemo(
    () =>
      `mailto:${productSupportEmail}?subject=${encodeURIComponent('Доступ к демо / тест (7 дней)')}&body=${encodeURIComponent('Здравствуйте! Хочу получить доступ к демо.\n\nКомпания / контакт:\n')}`,
    [],
  );

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
        body: JSON.stringify({ email: email.trim(), password, plan: selectedPlanValue, debug: debugGoogle }),
      });
      const data = await readResponseJson(res, {} as { error?: string; message?: string });
      if (!res.ok) {
        const msg =
          (data && typeof data.message === 'string' && data.message.trim()) ||
          (data && typeof data.error === 'string' && data.error.trim()) ||
          'Ошибка авторизации.';
        setError(msg);
        return;
      }
      router.push(afterAuthRedirect);
    } catch {
      setError('Ошибка сети. Попробуйте ещё раз.');
    } finally {
      setLoading(false);
    }
  };

  const handleGoogle = async () => {
    setError('');
    setGoogleStatus('');
    setLoading(true);
    try {
      if (debugGoogle) {
        // eslint-disable-next-line no-console
        console.info('[GoogleOAuth][/connect] click handler started', { oauthConfigured: googleOAuthConfigured, hasClientId: Boolean(googleClientId) });
      }

      if (!googleOAuthConfigured) {
        setError('Вход через Google сейчас недоступен (не настроено). Используйте email.');
        return;
      }

      // Mode 1: redirect OAuth (requires server-side client secret).
      if (googleOAuthMode === 'redirect') {
        const debug = debugGoogle ? '1' : '0';
        const url = `/api/auth/google/start?plan=${encodeURIComponent(String(selectedPlanValue))}&debug=${debug}&redirect=${encodeURIComponent(afterAuthRedirect)}`;
        setGoogleStatus('Открываем Google…');
        window.location.assign(url);
        return;
      }

      // Mode 2: GIS id_token (no server secret required). Requires client id.
      // If config wasn't available at click time, re-fetch once (protects against earlier transient failures).
      if (!googleClientId && !publicConfigFetchAttemptedRef.current) {
        publicConfigFetchAttemptedRef.current = true;
        try {
          const controller = new AbortController();
          const timeoutId = window.setTimeout(() => controller.abort(), 5000);
          let res: Response;
          try {
            res = await fetch('/api/public-config', { method: 'GET', signal: controller.signal });
          } finally {
            window.clearTimeout(timeoutId);
          }
          const data = await readResponseJson(res, emptyPublicConfig);
          const clientId = (data.googleClientId || '').trim();
          setGoogleClientId(clientId);
          if (debugGoogle) {
            // eslint-disable-next-line no-console
            console.info('[GoogleOAuth][/connect] click-time config fetched', { ok: res.ok, clientIdPresent: Boolean(clientId) });
          }
        } catch (e) {
          if (debugGoogle) {
            // eslint-disable-next-line no-console
            console.info('[GoogleOAuth][/connect] click-time config fetch failed', e);
          }
        }
      }

      if (!googleClientId) {
        setError('Вход через Google сейчас недоступен. Попробуйте позже или используйте email.');
        return;
      }

      await loadGoogleIdentityServices();
      if (debugGoogle) {
        // eslint-disable-next-line no-console
        console.info('[GoogleOAuth][/connect] GIS script loaded');
      }
      if (!window.google?.accounts?.id) {
        setError('Google авторизация недоступна. Попробуйте позже.');
        return;
      }

      const idToken: string = await new Promise((resolve, reject) => {
        const timer = window.setTimeout(() => reject(new Error('timeout')), 2 * 60 * 1000);
        let credentialReceived = false;

        if (debugGoogle) {
          // eslint-disable-next-line no-console
          console.info('[GoogleOAuth][/connect] GIS loaded, initializing');
        }

        window.google!.accounts!.id!.initialize({
          client_id: googleClientId,
          callback: (resp) => {
            if (debugGoogle) {
              // eslint-disable-next-line no-console
              console.info('[GoogleOAuth][/connect] credential callback fired', {
                hasCredential: Boolean(resp?.credential),
                select_by: (resp as { select_by?: string } | undefined)?.select_by,
              });
            }
            const token = resp?.credential;
            credentialReceived = true;
            window.clearTimeout(timer);
            if (token) {
              if (debugGoogle) {
                // eslint-disable-next-line no-console
                console.info('[GoogleOAuth][/connect] credential received');
              }
              resolve(token);
            } else {
              reject(new Error('no_credential'));
            }
          },
        });
        if (debugGoogle) {
          // eslint-disable-next-line no-console
          console.info('[GoogleOAuth][/connect] google.accounts.id.initialize succeeded');
        }

        // When the popup is dismissed (user closes Google chooser without selecting),
        // the callback never fires. Detect page focus returning to reset loading state.
        const onWindowFocus = () => {
          // Give GIS ~800ms to deliver the credential after focus returns.
          window.setTimeout(() => {
            if (!credentialReceived) {
              window.clearTimeout(timer);
              reject(new Error('dismissed'));
            }
          }, 800);
        };
        window.addEventListener('focus', onWindowFocus, { once: true });

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
          if (clickable) {
            clickable.click();
          } else {
            // renderButton produced nothing — fall through to prompt()
            window.removeEventListener('focus', onWindowFocus);
            if (debugGoogle) {
              // eslint-disable-next-line no-console
              console.info('[GoogleOAuth][/connect] calling prompt() after renderButton');
            }
            window.google!.accounts!.id!.prompt();
          }
          return;
        }

        // Fallback: One Tap prompt (may be blocked by browser settings).
        if (debugGoogle) {
          // eslint-disable-next-line no-console
          console.info('[GoogleOAuth][/connect] no render host, using prompt() fallback');
        }
        window.google!.accounts!.id!.prompt();
      });

      if (debugGoogle) {
        // eslint-disable-next-line no-console
        console.info('[GoogleOAuth][/connect] posting idToken to backend', { tokenLen: idToken.length });
      }
      const res = await fetch('/api/auth/google', {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({ idToken, plan: selectedPlanValue, debug: debugGoogle }),
      });
      const data = await readResponseJson(res, {} as { error?: string });
      if (!res.ok) {
        if (debugGoogle) {
          // eslint-disable-next-line no-console
          console.error('[GoogleOAuth][/connect] backend /api/auth/google failed', { status: res.status, data });
        }
        setError(data.error || 'Ошибка входа через Google.');
        return;
      }
      router.push(afterAuthRedirect);
    } catch (err) {
      const msg = err instanceof Error ? err.message : '';
      if (msg !== 'dismissed') {
        if (debugGoogle) {
          // eslint-disable-next-line no-console
          console.error('[GoogleOAuth][/connect] Google sign-in flow failed', err);
        }
        setError('Не удалось войти через Google. Используйте email.');
      }
    } finally {
      setLoading(false);
    }
  };

  return (
    <div className="w-full bg-transparent flex items-center justify-center px-4 py-10">
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
              <p className="mt-1 text-sm text-slate-600">Выберите формат в личном кабинете</p>
            </div>
          </div>

          <div className="mt-8 grid sm:grid-cols-2 gap-6">
            <div
              className="bg-white rounded-2xl border border-slate-200 p-5"
              data-connect-google-status={googleReady ? 'ready' : googleConfigLoading ? 'checking' : 'unavailable'}
              data-google-oauth-env={googleOAuthEnv || undefined}
            >
              <p className="text-sm font-semibold text-slate-900">Быстрый вход</p>
              <p
                className={`mt-2 flex items-center gap-2 text-xs font-medium ${
                  googleConfigLoading ? 'text-slate-500' : googleReady ? 'text-emerald-800' : 'text-amber-900'
                }`}
                aria-live="polite"
              >
                <span
                  className={`inline-block h-2 w-2 shrink-0 rounded-full ${
                    googleConfigLoading ? 'bg-slate-400' : googleReady ? 'bg-emerald-500' : 'bg-amber-500'
                  }`}
                  aria-hidden
                />
                {googleConfigLoading
                  ? 'Проверяем доступность Google…'
                  : googleReady
                    ? (googleOAuthMode === 'redirect'
                        ? 'Google: доступен'
                        : googleOAuthMode === 'gis'
                          ? 'Google: доступен (упрощённый режим)'
                          : 'Google: недоступен')
                    : 'Google: недоступен — выберите другой способ'}
              </p>

              {googleConfigLoading ? (
                <button
                  type="button"
                  disabled
                  className="mt-3 w-full px-5 py-3 rounded-xl bg-slate-200 text-slate-600 font-semibold cursor-wait"
                >
                  Проверяем…
                </button>
              ) : googleReady ? (
                <button
                  type="button"
                  onClick={handleGoogle}
                  disabled={loading}
                  className="mt-3 w-full px-5 py-3 rounded-xl bg-slate-900 text-white font-semibold hover:bg-slate-800 disabled:opacity-60 disabled:cursor-not-allowed"
                >
                  {loading ? 'Открываем Google…' : 'Войти через Google'}
                </button>
              ) : (
                <div className="mt-3 space-y-2">
                  <p className="text-sm text-slate-600">
                    Вход через Google сейчас недоступен. Вы всё равно можете начать тест: зарегистрируйтесь по email или напишите нам.
                  </p>
                  <a
                    href="https://t.me/ASI_core_bot"
                    target="_blank"
                    rel="noopener noreferrer"
                    className="flex w-full items-center justify-center px-5 py-3 rounded-xl bg-slate-900 text-white font-semibold hover:bg-slate-800"
                  >
                    Написать в Telegram
                  </a>
                  <a
                    href={demoMailto}
                    className="flex w-full items-center justify-center px-5 py-3 rounded-xl border border-slate-900 text-slate-900 font-semibold hover:bg-slate-50"
                  >
                    Запросить доступ по email
                  </a>
                  <div className="rounded-xl border border-slate-200 bg-slate-50 px-4 py-3">
                    <p className="text-xs font-semibold text-slate-700">Другие способы</p>
                    <p className="mt-1 text-xs text-slate-600">
                      Яндекс ID и VK ID пока не включены для входа. Можно использовать email или Telegram.
                    </p>
                  </div>
                  <div className="pt-1 text-center">
                    <a
                      href="/ru/contacts"
                      className="text-sm text-slate-600 underline underline-offset-2 hover:text-slate-900 transition-colors"
                    >
                      Страница контактов
                    </a>
                  </div>
                  <a href="#connect-email" className="block text-center text-sm text-slate-600 underline hover:text-slate-900">
                    Или продолжить с паролем →
                  </a>
                </div>
              )}
              {googleStatus ? <p className="mt-2 text-xs text-slate-600">{googleStatus}</p> : null}
              {error ? <p className="mt-2 text-sm text-red-600">{error}</p> : null}
              {/* Off-screen, not clipped — GIS needs real dimensions to render and click */}
              <div
                ref={gsiButtonHostRef}
                aria-hidden="true"
                style={{ position: 'fixed', top: '-9999px', left: '-9999px', width: '400px', height: '80px', overflow: 'visible' }}
              />
              <p className="mt-3 text-xs text-slate-500">
                Мы создадим рабочее пространство и запустим 7‑дневный тест.
              </p>
            </div>

            <div id="connect-email" className="bg-white rounded-2xl border border-slate-200 p-5 scroll-mt-8">
              <div className="flex items-center justify-between">
                <p className="text-sm font-semibold text-slate-900">Email</p>
                <div className="flex items-center gap-1 p-1 rounded-xl bg-slate-100 border border-slate-200">
                  <button
                    type="button"
                    className={`text-xs px-3 py-1.5 rounded-lg border transition-colors focus:outline-none focus-visible:ring-2 focus-visible:ring-slate-900 focus-visible:ring-offset-2 focus-visible:ring-offset-white ${
                      mode === 'signup'
                        ? 'bg-slate-900 text-white border-slate-900'
                        : 'bg-transparent text-slate-700 border-transparent hover:bg-white hover:border-slate-200'
                    }`}
                    onClick={() => setMode('signup')}
                    disabled={loading}
                  >
                    Регистрация
                  </button>
                  <button
                    type="button"
                    className={`text-xs px-3 py-1.5 rounded-lg border transition-colors focus:outline-none focus-visible:ring-2 focus-visible:ring-slate-900 focus-visible:ring-offset-2 focus-visible:ring-offset-white ${
                      mode === 'login'
                        ? 'bg-slate-900 text-white border-slate-900'
                        : 'bg-transparent text-slate-700 border-transparent hover:bg-white hover:border-slate-200'
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
