import { readFileSync } from 'node:fs';
import vm from 'node:vm';
import ts from 'typescript';
import { describe, expect, it, vi } from 'vitest';

// Execute the real effect bodies, not #544's deliberately historical fixture.
// Hooks/DOM/GIS/network are mocked; this is not browser or human-login evidence.
const source = readFileSync(new URL('../OnboardingPageContent.tsx', import.meta.url), 'utf8');
const gisEffect = source.slice(source.indexOf('  // GIS requires'), source.indexOf('  const demoMailto'));
const configEffect = source.slice(source.indexOf('  useEffect(() => {\n    let cancelled'), source.indexOf('  const googleErrorParam'));
const jsonHelper = readFileSync(new URL('../../lib/safeResponseJson.ts', import.meta.url), 'utf8').replaceAll('export ', '');

type Credential = { credential?: string };
type Reply = { ok: boolean; text: () => Promise<string> };
function deferred<T>() {
  let resolve!: (value: T) => void;
  let reject!: (error: Error) => void;
  const promise = new Promise<T>((yes, no) => { resolve = yes; reject = no; });
  return { promise, resolve, reject };
}
const reply = (ok = true, body = '{}'): Reply => ({ ok, text: vi.fn(async () => body) });
const flush = async () => { for (let i = 0; i < 12; i++) await Promise.resolve(); };

function setup(options: { loader?: () => Promise<void>; fetcher?: () => Promise<Reply> } = {}) {
  const callbacks: ((response: Credential) => Promise<void>)[] = [];
  const changes: [string, unknown][] = [];
  const state: Record<string, unknown> = {};
  const setter = (name: string) => vi.fn((value: unknown) => { state[name] = value; changes.push([name, value]); });
  const host = { replaceChildren: vi.fn() };
  const fetcher = vi.fn(options.fetcher || (async () => reply()));
  const loader = vi.fn(options.loader || (async () => undefined));
  const push = vi.fn();
  const renderButton = vi.fn();
  const context = vm.createContext({
    AbortController, JSON,
    googleReady: true, googleOAuthMode: 'gis', googleClientId: 'fake-client.invalid',
    gsiButtonHostRef: { current: host }, gisRequestPendingRef: { current: false },
    isMountedRef: { current: true }, mode: 'signup', rental: false,
    selectedPlanValue: 'small', afterAuthRedirect: '/dashboard', debugGoogle: false,
    router: { push }, loadGoogleIdentityServices: loader, fetch: fetcher,
    setGoogleStatus: setter('status'), setLoading: setter('loading'), setError: setter('error'),
    setGoogleConfigLoading: setter('configLoading'), setGoogleClientId: setter('client'),
    setGoogleOAuthConfigured: setter('configured'), setGoogleOAuthEnv: setter('env'),
    setGoogleOAuthMode: setter('oauthMode'), emptyPublicConfig: {},
    window: { setTimeout, clearTimeout, google: { accounts: { id: {
      initialize: ({ callback }: { callback: (response: Credential) => Promise<void> }) => callbacks.push(callback),
      renderButton,
    } } } },
  });
  let cleanup: (() => void) | undefined;
  let dependencies: unknown[] = [];
  context.useEffect = (fn: () => (() => void) | undefined, deps: unknown[]) => { cleanup = fn(); dependencies = deps; };
  const run = async (updates: Record<string, unknown> = {}, effect = gisEffect) => {
    Object.assign(context, updates);
    vm.runInContext(ts.transpile(jsonHelper + effect, { target: ts.ScriptTarget.ES2022 }), context);
    await flush();
  };
  return { callbacks, changes, state, host, fetcher, loader, push, renderButton, context, run,
    cleanup: () => cleanup?.(), dependencies: () => dependencies,
    callback: (credential = 'FAKE_TEST_CREDENTIAL') => callbacks.at(-1)!({ credential }),
  };
}

describe('Google GIS effect lifecycle', () => {
  it('renders into the visible host without initiating authentication', async () => {
    const h = setup(); await h.run();
    expect(h.renderButton).toHaveBeenCalledWith(h.host, expect.objectContaining({ type: 'standard', text: 'signup_with' }));
    expect(source).toContain('data-testid="google-gis-visible-button"');
    expect(source).not.toMatch(/\.click\(\)|top: '-9999px'|\.prompt\(/);
    expect(h.fetcher).not.toHaveBeenCalled();
  });
  it('accepts a delivered credential, preserves POST/plan/redirect and clears loading', async () => {
    const h = setup(); await h.run(); await h.callback();
    expect(h.fetcher).toHaveBeenCalledOnce();
    const [url, init] = h.fetcher.mock.calls[0] as unknown as [string, RequestInit];
    expect(url).toBe('/api/auth/google'); expect(init.method).toBe('POST');
    expect(JSON.parse(init.body as string)).toEqual({ idToken: 'FAKE_TEST_CREDENTIAL', plan: 'small', debug: false });
    expect(h.push).toHaveBeenCalledExactlyOnceWith('/dashboard');
    expect(h.state.loading).toBe(false); expect(h.state.status).toBe('');
  });
  it('keeps rental plan omitted and the selected safe redirect', async () => {
    const h = setup(); await h.run({ rental: true, afterAuthRedirect: '/ru/legal-onboarding' }); await h.callback();
    const [, init] = h.fetcher.mock.calls[0] as unknown as [string, RequestInit];
    expect(JSON.parse(init.body as string)).not.toHaveProperty('plan');
    expect(h.push).toHaveBeenCalledWith('/ru/legal-onboarding');
  });
  it('rejects empty credentials without a request', async () => {
    const h = setup(); await h.run(); await h.callback('');
    expect(h.fetcher).not.toHaveBeenCalled(); expect(h.state.error).toBe('Google не вернул данные для входа.');
  });
  it('shows a server 4xx error and allows a later retry', async () => {
    const h = setup({ fetcher: async () => reply(false, '{"error":"denied"}') });
    await h.run(); await h.callback();
    expect(h.state.error).toBe('denied'); expect(h.state.loading).toBe(false); expect(h.push).not.toHaveBeenCalled();
    h.fetcher.mockResolvedValueOnce(reply()); await h.callback(); expect(h.push).toHaveBeenCalledOnce();
  });
  it('shows a current network error without redirecting', async () => {
    const h = setup({ fetcher: async () => { throw new Error('fixture'); } }); await h.run(); await h.callback();
    expect(h.state.error).toContain('Не удалось завершить вход'); expect(h.state.loading).toBe(false); expect(h.push).not.toHaveBeenCalled();
  });
  it('shows loader failure without posting credentials', async () => {
    const h = setup({ loader: async () => { throw new Error('fixture'); } }); await h.run();
    expect(h.state.error).toContain('Не удалось загрузить Google'); expect(h.fetcher).not.toHaveBeenCalled();
  });
  it('ignores a loader resolving or rejecting after cleanup', async () => {
    for (const fail of [false, true]) {
      const wait = deferred<void>(); const h = setup({ loader: () => wait.promise }); await h.run(); h.cleanup();
      const changes = h.changes.length;
      if (fail) wait.reject(new Error('fixture')); else wait.resolve(undefined);
      await flush(); expect(h.changes).toHaveLength(changes); expect(h.callbacks).toHaveLength(0);
    }
  });
  it('does nothing when the chooser is dismissed without a credential', async () => {
    const h = setup(); await h.run(); await flush();
    expect(h.fetcher).not.toHaveBeenCalled(); expect(h.state.loading).not.toBe(true); expect(h.state.error).toBeUndefined();
  });
  it('ignores a saved GIS callback after cleanup', async () => {
    const h = setup(); await h.run(); h.cleanup(); const changes = h.changes.length; await h.callback();
    expect(h.changes).toHaveLength(changes); expect(h.fetcher).not.toHaveBeenCalled();
  });
  it('aborts on cleanup and ignores fetch completion even if transport ignores abort', async () => {
    const wait = deferred<Reply>(); const h = setup({ fetcher: () => wait.promise }); await h.run();
    const pending = h.callback(); h.cleanup(); const changes = h.changes.length;
    const [, init] = h.fetcher.mock.calls[0] as unknown as [string, RequestInit];
    expect(init.signal?.aborted).toBe(true);
    const res = reply(); wait.resolve(res); await pending;
    expect(res.text).not.toHaveBeenCalled(); expect(h.push).not.toHaveBeenCalled(); expect(h.changes).toHaveLength(changes);
  });
  it('ignores both successful and failed bodies completing after cleanup', async () => {
    for (const ok of [true, false]) {
      const body = deferred<string>(); const h = setup({ fetcher: async () => ({ ok, text: () => body.promise }) });
      await h.run(); const pending = h.callback(); await flush(); h.cleanup(); const changes = h.changes.length;
      body.resolve('{"error":"late"}'); await pending;
      expect(h.push).not.toHaveBeenCalled(); expect(h.changes).toHaveLength(changes);
    }
  });
  it('ignores rejection after cleanup, including finally state changes', async () => {
    const wait = deferred<Reply>(); const h = setup({ fetcher: () => wait.promise }); await h.run();
    const pending = h.callback(); h.cleanup(); const changes = h.changes.length; wait.reject(new Error('aborted')); await pending;
    expect(h.changes).toHaveLength(changes); expect(h.push).not.toHaveBeenCalled();
  });
  it('serializes overlapping credential deliveries into one POST', async () => {
    const wait = deferred<Reply>(); const h = setup({ fetcher: () => wait.promise }); await h.run();
    const pending = h.callback(); await h.callback('SECOND_FAKE_CREDENTIAL');
    expect(h.fetcher).toHaveBeenCalledOnce(); wait.resolve(reply()); await pending;
    expect(h.push).toHaveBeenCalledOnce();
  });
  it('isolates old callbacks across remount/mode/plan/redirect generations', async () => {
    const old = deferred<Reply>(); const current = deferred<Reply>();
    const h = setup(); h.fetcher.mockReturnValueOnce(old.promise).mockReturnValueOnce(current.promise);
    await h.run(); const oldCallback = h.callbacks[0]; const first = h.callback(); h.cleanup();
    await h.run({ mode: 'login', selectedPlanValue: 'growth', afterAuthRedirect: '/dashboard/crm/queue' });
    expect(h.state.loading).toBe(false);
    expect(h.renderButton).toHaveBeenLastCalledWith(h.host, expect.objectContaining({ text: 'signin_with' }));
    await oldCallback({ credential: 'STALE_FAKE_CREDENTIAL' });
    const second = h.callback(); const changes = h.changes.length; old.resolve(reply()); await first;
    expect(h.changes).toHaveLength(changes); expect(h.state.loading).toBe(true); expect(h.push).not.toHaveBeenCalled();
    current.resolve(reply()); await second;
    expect(h.fetcher).toHaveBeenCalledTimes(2); expect(h.push).toHaveBeenCalledExactlyOnceWith('/dashboard/crm/queue');
    const [, init] = h.fetcher.mock.calls[1] as unknown as [string, RequestInit];
    expect(JSON.parse(init.body as string).plan).toBe('growth');
    expect(h.dependencies()).toContain('login'); expect(h.dependencies()).toContain('growth');
  });
  it('preserves redirect mode and clears a replaced pending GIS view', async () => {
    const wait = deferred<Reply>(); const h = setup({ fetcher: () => wait.promise }); await h.run();
    const pending = h.callback(); h.cleanup(); await h.run({ googleOAuthMode: 'redirect' });
    expect(h.callbacks).toHaveLength(1); expect(h.state.loading).toBe(false); expect(h.state.status).toBe('');
    wait.resolve(reply()); await pending; expect(h.push).not.toHaveBeenCalled();
    let redirectHandler!: () => void;
    h.context.window.location = { assign: vi.fn() }; h.context.googleOAuthConfigured = true;
    h.context.capture = (fn: () => void) => { redirectHandler = fn; };
    const handler = source.slice(source.indexOf('  const handleGoogle ='), source.indexOf('\n  return (', source.indexOf('  const handleGoogle =')));
    vm.runInContext(ts.transpile(handler + '\ncapture(handleGoogle);'), h.context);
    redirectHandler();
    expect(h.context.window.location.assign).toHaveBeenCalledWith('/api/auth/google/start?plan=small&debug=0&redirect=%2Fdashboard');
  });
  it('does not let stale config completion clear a new config loading state', async () => {
    const old = deferred<Reply>(); const fresh = deferred<Reply>(); const h = setup();
    h.fetcher.mockReturnValueOnce(old.promise).mockReturnValueOnce(fresh.promise);
    await h.run({}, configEffect); h.cleanup(); await h.run({}, configEffect); const changes = h.changes.length;
    old.resolve(reply()); await flush(); expect(h.changes).toHaveLength(changes); expect(h.state.configLoading).toBe(true);
    fresh.resolve(reply()); await flush(); expect(h.state.configLoading).toBe(false);
  });
});
