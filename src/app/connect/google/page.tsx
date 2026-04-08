'use client';

import { useEffect, useMemo, useState } from 'react';

// Minimal Google implicit flow helper page.
// Uses Google OAuth "id_token" response in URL fragment and posts it back to opener.
const GOOGLE_AUTH_ENDPOINT = 'https://accounts.google.com/o/oauth2/v2/auth';

function buildAuthUrl(opts: { clientId: string; redirectUri: string; nonce: string }) {
  const u = new URL(GOOGLE_AUTH_ENDPOINT);
  u.searchParams.set('client_id', opts.clientId);
  u.searchParams.set('redirect_uri', opts.redirectUri);
  u.searchParams.set('response_type', 'id_token');
  u.searchParams.set('scope', 'openid email profile');
  u.searchParams.set('prompt', 'select_account');
  u.searchParams.set('nonce', opts.nonce);
  return u.toString();
}

export default function ConnectGooglePage() {
  const [error, setError] = useState<string | null>(null);

  const nonce = useMemo(() => Math.random().toString(36).slice(2), []);

  useEffect(() => {
    const hash = window.location.hash || '';
    if (hash.includes('id_token=')) {
      const params = new URLSearchParams(hash.replace(/^#/, ''));
      const idToken = params.get('id_token');
      if (idToken && window.opener) {
        window.opener.postMessage({ type: 'asi_google_id_token', idToken }, window.location.origin);
        window.close();
        return;
      }
      setError('Не удалось вернуть токен в основное окно.');
      return;
    }

    const clientId = process.env.NEXT_PUBLIC_GOOGLE_CLIENT_ID;
    if (!clientId) {
      setError('Google авторизация не настроена.');
      return;
    }

    const redirectUri = `${window.location.origin}/connect/google`;
    const url = buildAuthUrl({ clientId, redirectUri, nonce });
    window.location.replace(url);
  }, [nonce]);

  return (
    <div className="min-h-screen bg-white flex items-center justify-center px-4">
      <div className="max-w-md w-full bg-slate-50 border border-slate-200 rounded-2xl p-6 text-center">
        <h1 className="text-lg font-semibold text-slate-900">Вход через Google</h1>
        <p className="mt-2 text-sm text-slate-600">
          {error ? error : 'Открываем Google…'}
        </p>
      </div>
    </div>
  );
}

