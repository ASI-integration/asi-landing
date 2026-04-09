'use client';

import { useEffect, useMemo, useState } from 'react';
import { loadGoogleIdentityServices } from '@/lib/googleIdentity';

export default function ConnectGooglePage() {
  const [error, setError] = useState<string | null>(null);
  const [debugInfo, setDebugInfo] = useState<{
    clientId: string;
    redirectUri: string;
  } | null>(null);

  const nonce = useMemo(() => Math.random().toString(36).slice(2), []);

  useEffect(() => {
    const clientId = (process.env.NEXT_PUBLIC_GOOGLE_CLIENT_ID || '').trim();
    if (!clientId) {
      setError('Google авторизация не настроена.');
      return;
    }

    const redirectUri = `${window.location.origin}/connect/google`;
    const debug = new URLSearchParams(window.location.search).get('debug') === '1';

    if (debug) {
      const info = { clientId, redirectUri };
      setDebugInfo(info);
      // eslint-disable-next-line no-console
      console.info('[GoogleOAuth][debug]', info);
      return;
    }

    // Modern Google Sign-In (GIS). No redirect/implicit flow.
    (async () => {
      try {
        await loadGoogleIdentityServices();
        if (!window.google?.accounts?.id) {
          throw new Error('Google Identity Services unavailable');
        }

        window.google.accounts.id.initialize({
          client_id: clientId,
          callback: (resp) => {
            const idToken = resp?.credential;
            if (!idToken) {
              setError('Google не вернул токен. Попробуйте ещё раз.');
              return;
            }
            if (window.opener) {
              window.opener.postMessage({ type: 'asi_google_id_token', idToken }, window.location.origin);
              window.close();
              return;
            }
            setError('Не удалось вернуть токен в основное окно.');
          },
        });

        // Trigger One Tap / browser-native prompt.
        window.google.accounts.id.prompt();
      } catch (e) {
        console.error('[GoogleOAuth][GIS]', e);
        setError('Не удалось открыть вход Google. Попробуйте ещё раз.');
      }
    })();
  }, [nonce]);

  return (
    <div className="min-h-screen bg-white flex items-center justify-center px-4">
      <div className="max-w-md w-full bg-slate-50 border border-slate-200 rounded-2xl p-6 text-center">
        <h1 className="text-lg font-semibold text-slate-900">Вход через Google</h1>
        <p className="mt-2 text-sm text-slate-600">
          {error ? error : 'Открываем Google…'}
        </p>
        {debugInfo && (
          <div className="mt-4 text-left">
            <p className="text-xs font-semibold text-slate-700">Debug</p>
            <div className="mt-2 space-y-2 text-xs text-slate-700 break-all">
              <div>
                <span className="font-semibold">client_id:</span> {debugInfo.clientId}
              </div>
              <div>
                <span className="font-semibold">redirect_uri:</span> {debugInfo.redirectUri}
              </div>
            </div>
          </div>
        )}
      </div>
    </div>
  );
}

