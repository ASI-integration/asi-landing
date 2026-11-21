/** Shared onboarding body for `/connect` and related auth entry flows. */
'use client';

import { useEffect, useMemo, useRef, useState } from 'react';
import { useRouter } from 'next/navigation';
import { useSearchParams } from 'next/navigation';
import { loadGoogleIdentityServices } from '@/lib/googleIdentity';
import { readResponseJson } from '@/lib/safeResponseJson';
import { safeAuthRedirectPath } from '@/lib/auth/app-url';
import { RU_LEGAL_ONBOARDING_PATH } from '@/lib/rental-connect/model';
import { productSupportEmail } from '@/config/contact';
import { telegramSupportBotUrl } from '@/config/telegramBots';

type PublicConfigResponse = {
  googleClientId?: string;
  googleOAuthConfigured?: boolean;
  googleOAuthEnv?: string;
  googleOAuthMode?: 'redirect' | 'gis' | 'disabled';
};

const emptyPublicConfig: PublicConfigResponse = {};

type PricingPlan = 'small' | 'growth' | 'enterprise';
const SELECTED_PLAN_STORAGE_KEY = 'asi.selectedPlan';

export default function OnboardingPageContent({ rental = false }: { rental?: boolean }) {
  const router = useRouter();
  const searchParams = useSearchParams();
  const [loading, setLoading] = useState(false);
  // Deep links from the RU public site can open the email login tab directly.
  const [mode, setMode] = useState<'signup' | 'login'>(
    searchParams.get('mode') === 'login' ? 'login' : 'signup',
  );
  const [email, setEmail] = useState('');
  const [password, setPassword] = useState('');
  const [error, setError] = useState('');
  const [googleStatus, setGoogleStatus] = useState<string>('');
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
  const gisRequestPendingRef = useRef(false);
  const emailRequestPendingRef = useRef(false);
  const debugGoogle = useMemo(() => searchParams.get('debugGoogle') === '1', [searchParams]);
  const afterAuthRedirect = useMemo(
    () => safeAuthRedirectPath(searchParams.get('redirect') || (rental ? RU_LEGAL_ONBOARDING_PATH : null)),
    [searchParams, rental],
  );

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
        if (!cancelled && isMountedRef.current) setGoogleConfigLoading(false);
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
    if (plan === 'small') return 'Starter';
    if (plan === 'growth') return 'Growth';
    return 'Enterprise';
  }, [selectedPlanValue]);

  const googleReady = googleOAuthConfigured && !googleConfigLoading;

  // GIS requires a visible Google-rendered button and a real user click.
  // Programmatically clicking a hidden iframe is unreliable and may be blocked.
  useEffect(() => {
    // A replaced GIS generation must not leave the new view in a loading state.
    if (gisRequestPendingRef.current) {
      gisRequestPendingRef.current = false;
      setLoading(false);
      setGoogleStatus('');
    }
    if (!googleReady || googleOAuthMode !== 'gis' || !googleClientId) return;
    const host = gsiButtonHostRef.current;
    if (!host) return;

    let cancelled = false;
    let requestPending = false;
    let controller: AbortController | undefined;
    let resizeObserver: ResizeObserver | undefined;
    const isCurrent = () => !cancelled && isMountedRef.current;
    setGoogleStatus('Загружаем кнопку Google…');
    (async () => {
      try {
        await loadGoogleIdentityServices();
        if (!isCurrent()) return;
        const googleId = window.google?.accounts?.id;
        if (!googleId) throw new Error('google_identity_unavailable');
        googleId.initialize({
          client_id: googleClientId,
          callback: async (resp) => {
            // Single flight: repeated GIS delivery must not create concurrent sessions.
            if (!isCurrent() || requestPending || emailRequestPendingRef.current) return;
            const idToken = resp?.credential;
            if (!idToken) {
              setError('Google не вернул данные для входа.');
              return;
            }
            requestPending = true;
            gisRequestPendingRef.current = true;
            controller = new AbortController();
            setLoading(true);
            setError('');
            setGoogleStatus('Проверяем вход Google…');
            try {
              const res = await fetch('/api/auth/google', {
                method: 'POST',
                signal: controller.signal,
                headers: { 'Content-Type': 'application/json' },
                body: JSON.stringify({
                  idToken,
                  plan: rental ? undefined : selectedPlanValue,
                  debug: debugGoogle,
                }),
              });
              if (!isCurrent()) return;
              const data = await readResponseJson(res, {} as { error?: string });
              if (!isCurrent()) return;
              if (!res.ok) {
                setError(data.error || 'Ошибка входа через Google.');
                return;
              }
              router.push(afterAuthRedirect);
            } catch {
              if (isCurrent()) setError('Не удалось завершить вход через Google. Проверьте соединение.');
            } finally {
              requestPending = false;
              if (isCurrent()) {
                gisRequestPendingRef.current = false;
                setLoading(false);
                setGoogleStatus('');
              }
            }
          },
        });
        let renderedWidth = -1;
        const render = () => {
          if (!isCurrent()) return;
          const width = Math.min(400, Math.floor(host.getBoundingClientRect().width));
          if (width <= 0 || width === renderedWidth) return;
          renderedWidth = width;
          host.replaceChildren();
          // Use Google's compact genuine button when a labelled button cannot fit.
          googleId.renderButton(host, {
            type: width < 200 ? 'icon' : 'standard',
            theme: 'outline',
            size: 'large',
            text: mode === 'signup' ? 'signup_with' : 'signin_with',
            shape: 'pill',
            logo_alignment: 'left',
            ...(width >= 200 ? { width: String(width) } : {}),
          });
        };
        render();
        resizeObserver = new ResizeObserver(render);
        resizeObserver.observe(host);
        if (isCurrent()) setGoogleStatus('');
      } catch {
        if (!isCurrent()) return;
        setGoogleStatus('');
        setError('Не удалось загрузить Google. Проверьте блокировку Google в браузере.');
      }
    })();
    return () => {
      cancelled = true;
      controller?.abort();
      resizeObserver?.disconnect();
      host.replaceChildren();
    };
  }, [googleReady, googleOAuthMode, googleClientId, mode, rental, selectedPlanValue, afterAuthRedirect, debugGoogle, router]);
  const demoMailto = useMemo(
    () =>
      `mailto:${productSupportEmail}?subject=${encodeURIComponent(rental ? 'Подключение объекта к ASI' : 'GuestAutopilot demo and onboarding')}&body=${encodeURIComponent(rental ? 'Здравствуйте! Хочу получить доступ к демо.\n\nКомпания / контакт:\n' : 'Hello, I would like to discuss onboarding.\n\nCompany / contact:\n')}`,
    [rental],
  );

  const handleEmailAuth = async (e: React.FormEvent) => {
    e.preventDefault();
    if (emailRequestPendingRef.current || gisRequestPendingRef.current) return;
    setError('');
    if (!email.trim() || !password) {
      setError(rental ? 'Укажите email и пароль.' : 'Please enter your email and password.');
      return;
    }

    emailRequestPendingRef.current = true;
    setLoading(true);
    try {
      const endpoint = mode === 'signup' ? '/api/auth/signup' : '/api/auth/login';
      const res = await fetch(endpoint, {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({ email: email.trim(), password, plan: rental ? undefined : selectedPlanValue, debug: debugGoogle }),
      });
      const data = await readResponseJson(res, {} as { error?: string; message?: string });
      if (!res.ok) {
        const msg =
          (data && typeof data.message === 'string' && data.message.trim()) ||
          (data && typeof data.error === 'string' && data.error.trim()) ||
          'Authentication failed.';
        setError(rental && res.status === 401 ? 'Неверный email или пароль.' : rental && !data.message ? 'Не удалось войти. Проверьте данные и попробуйте ещё раз.' : rental ? msg : 'Could not sign in. Please check your details or contact support.');
        return;
      }
      router.push(afterAuthRedirect);
    } catch {
      setError(rental ? 'Ошибка сети. Попробуйте ещё раз.' : 'Network error. Please try again.');
    } finally {
      emailRequestPendingRef.current = false;
      setLoading(false);
    }
  };

  const handleGoogle = () => {
    setError('');
    if (!googleOAuthConfigured || googleOAuthMode !== 'redirect') {
      setError(rental ? 'Вход через Google пока недоступен.' : 'Google sign-in is not currently available. Use your email and password.');
      return;
    }
    setLoading(true);
    setGoogleStatus(rental ? 'Открываем Google…' : 'Opening Google…');
    const debug = debugGoogle ? '1' : '0';
    const url = `/api/auth/google/start?${rental ? '' : `plan=${encodeURIComponent(String(selectedPlanValue))}&`}debug=${debug}&redirect=${encodeURIComponent(afterAuthRedirect)}`;
    window.location.assign(url);
  };

  return (
    <div className="w-full bg-transparent flex items-center justify-center px-4 py-10">
      <div className="w-full max-w-2xl">
        <div className={rental ? "bg-asi-paper border border-asi-border p-5 sm:p-8" : "bg-slate-50 border border-slate-200 rounded-2xl p-6 sm:p-8 shadow-sm"}>
          <h1 className="text-2xl sm:text-3xl font-bold text-slate-900 tracking-tight">
            {rental ? 'Подключение объекта к ASI' : 'Create your GuestAutopilot account'}
          </h1>
          {rental ? (
            <div className="mt-4 space-y-3 text-base text-slate-700">
              <p>Войдите или создайте кабинет. Следующий шаг — выбрать ваш менеджер каналов, затем площадки и данные объекта.</p>
              <p>Настройка — 0 ₽. 14 бесплатных дней начнутся после полной готовности объекта, а не после регистрации.</p>
            </div>
          ) : (<>
          <p className="mt-2 text-slate-600">
            Your selected plan is <span className="font-semibold text-slate-900">{selectedPlanLabel}</span>. Registration gives you access to your workspace; a 14-day property pilot begins only when the required integrations are verified. No automatic billing.
          </p>

          <div className="mt-6 grid sm:grid-cols-3 gap-3">
            <div className="bg-white rounded-xl border border-slate-200 p-4">
              <p className="text-sm font-medium text-slate-900">Selected plan</p>
              <p className="mt-1 text-sm text-slate-600">{selectedPlanLabel}</p>
            </div>
            <div className="bg-white rounded-xl border border-slate-200 p-4">
              <p className="text-sm font-medium text-slate-900">Property pilot</p>
              <p className="mt-1 text-sm text-slate-600">14 days after readiness</p>
            </div>
            <div className="bg-white rounded-xl border border-slate-200 p-4">
              <p className="text-sm font-medium text-slate-900">After the pilot</p>
              <p className="mt-1 text-sm text-slate-600">Only with separately confirmed terms and consent</p>
            </div>
          </div>

          </>)}

          <div className={`mt-8 grid gap-6 ${rental ? "" : "sm:grid-cols-2"}`}>
            <div
              className="min-w-0 bg-white rounded-2xl border border-slate-200 p-5"
              data-connect-google-status={googleReady ? 'ready' : googleConfigLoading ? 'checking' : 'unavailable'}
              data-google-oauth-env={googleOAuthEnv || undefined}
            >
              <p className="text-sm font-semibold text-slate-900">{rental ? 'Быстрый вход' : 'Quick sign-in'}</p>
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
                  ? (rental ? 'Проверяем доступность Google…' : 'Checking Google availability…')
                  : googleReady
                    ? (googleOAuthMode === 'redirect'
                        ? 'Google: доступен'
                        : googleOAuthMode === 'gis'
                          ? 'Google: доступен'
                          : 'Google: недоступен')
                    : (rental ? 'Google: недоступен — выберите другой способ' : 'Google sign-in unavailable — use email')}
              </p>

              {googleConfigLoading ? (
                <button
                  type="button"
                  disabled
                  className="mt-3 w-full px-5 py-3 rounded-xl bg-slate-200 text-slate-600 font-semibold cursor-wait"
                >
                  {rental ? 'Проверяем…' : 'Checking…'}
                </button>
              ) : googleReady && googleOAuthMode === 'gis' ? (
                <div className="mt-3 min-h-[44px]" data-testid="google-gis-visible-button">
                  <div ref={gsiButtonHostRef} className="w-full min-w-0 overflow-hidden" aria-label={rental ? 'Войти через Google' : 'Sign in with Google'} />
                  {loading ? <p className="mt-2 text-sm text-slate-600">{rental ? 'Проверяем вход Google…' : 'Verifying Google sign-in…'}</p> : null}
                </div>
              ) : googleReady ? (                <button
                  type="button"
                  onClick={handleGoogle}
                  disabled={loading}
                  className="mt-3 w-full px-5 py-3 rounded-xl bg-slate-900 text-white font-semibold hover:bg-slate-800 disabled:opacity-60 disabled:cursor-not-allowed"
                >
                  {loading ? (rental ? 'Открываем Google…' : 'Opening Google…') : (rental ? 'Войти через Google' : 'Sign in with Google')}
                </button>
              ) : rental ? (
                <p className="mt-3 text-base text-slate-600">Вход через Google сейчас недоступен. Зарегистрируйтесь или войдите по почте ниже.</p>
              ) : (
                <div className="mt-3 space-y-2">
                  <p className="text-sm text-slate-600">
                    Google sign-in is unavailable. Create an account using email and password, or contact our team.
                  </p>
                  <a
                    href={telegramSupportBotUrl}
                    target="_blank"
                    rel="noopener noreferrer"
                    className="flex w-full items-center justify-center px-5 py-3 rounded-xl bg-slate-900 text-white font-semibold hover:bg-slate-800"
                  >
                    Contact us on Telegram
                  </a>
                  <a
                    href={demoMailto}
                    className="flex w-full items-center justify-center px-5 py-3 rounded-xl border border-slate-900 text-slate-900 font-semibold hover:bg-slate-50"
                  >
                    Request access by email
                  </a>
                  <div className="rounded-xl border border-slate-200 bg-slate-50 px-4 py-3">
                    <p className="text-xs font-semibold text-slate-700">Other options</p>
                    <p className="mt-1 text-xs text-slate-600">
                      Email and password are available. Other social sign-in options are not enabled.
                    </p>
                  </div>
                  <div className="pt-1 text-center">
                    <a
                      href="/contacts"
                      className="text-sm text-slate-600 underline underline-offset-2 hover:text-slate-900 transition-colors"
                    >
                      Contact page
                    </a>
                  </div>
                  <a href="#connect-email" className="block text-center text-sm text-slate-600 underline hover:text-slate-900">
                    Or use email and password →
                  </a>
                </div>
              )}
              {googleStatus ? <p className="mt-2 text-xs text-slate-600">{googleStatus}</p> : null}
              {error ? <p role="alert" className="mt-2 text-base text-red-700">{error}</p> : null}
              <p className="mt-3 text-xs text-slate-500">
                {rental ? 'Вы вернётесь к настройке после входа.' : 'Account creation does not start a property trial, activate a subscription or charge your card.'}
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
                    {rental ? 'Регистрация' : 'Sign up'}
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
                    {rental ? 'Вход' : 'Sign in'}
                  </button>
                </div>
              </div>

              <form onSubmit={handleEmailAuth} className="mt-4 space-y-3">
                <div>
                  <label htmlFor="connect-email-input" className="block text-sm font-medium text-slate-600">{rental ? 'Электронная почта' : 'Email address'}</label>
                  <input
                    id="connect-email-input"
                    name="email"
                    autoComplete="email"
                    required
                    value={email}
                    onChange={(e) => setEmail(e.target.value)}
                    type="email"
                    className="mt-1 w-full px-4 py-3 rounded-xl border border-slate-200 focus:outline-none focus:ring-2 focus:ring-slate-900"
                    placeholder={rental ? 'you@company.ru' : 'you@company.com'}
                    disabled={loading}
                  />
                </div>
                <div>
                  <label htmlFor="connect-password" className="block text-sm font-medium text-slate-600">{rental ? 'Пароль' : 'Password'}</label>
                  <input
                    id="connect-password"
                    name="password"
                    autoComplete={mode === 'signup' ? 'new-password' : 'current-password'}
                    minLength={mode === 'signup' ? 6 : undefined}
                    required
                    value={password}
                    onChange={(e) => setPassword(e.target.value)}
                    type="password"
                    className="mt-1 w-full px-4 py-3 rounded-xl border border-slate-200 focus:outline-none focus:ring-2 focus:ring-slate-900"
                    placeholder={rental ? 'Минимум 6 символов' : 'At least 6 characters'}
                    disabled={loading}
                  />
                </div>
                <button
                  type="submit"
                  disabled={loading}
                  className="w-full px-5 py-3 rounded-xl bg-white border border-slate-900 text-slate-900 font-semibold hover:bg-slate-50 disabled:opacity-60"
                >
                  {loading ? (rental ? 'Подождите…' : 'Please wait…') : mode === 'signup' ? (rental ? 'Создать кабинет и продолжить →' : 'Create account and continue →') : (rental ? 'Войти и продолжить →' : 'Sign in and continue →')}
                </button>
              </form>
            </div>
          </div>
        </div>
      </div>
    </div>
  );
}
