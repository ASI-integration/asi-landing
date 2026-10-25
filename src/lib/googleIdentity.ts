export type GoogleIdCredentialResponse = {
  credential?: string;
  select_by?: string;
  clientId?: string;
};

declare global {
  interface Window {
    google?: {
      accounts?: {
        id?: {
          initialize: (opts: { client_id: string; callback: (resp: GoogleIdCredentialResponse) => void }) => void;
          renderButton: (
            parent: HTMLElement,
            options?: {
              type?: 'standard' | 'icon';
              theme?: 'outline' | 'filled_blue' | 'filled_black';
              size?: 'large' | 'medium' | 'small';
              text?: 'signin_with' | 'signup_with' | 'continue_with' | 'signin';
              shape?: 'rectangular' | 'pill' | 'circle' | 'square';
              logo_alignment?: 'left' | 'center';
              width?: number | string;
              locale?: string;
            }
          ) => void;
          prompt: (momentListener?: (notification: unknown) => void) => void;
          cancel: () => void;
        };
      };
    };
  }
}

let gsiLoadPromise: Promise<void> | null = null;

/** Never leave authentication stuck indefinitely when Google's script is blocked. */
export function loadGoogleIdentityServices(): Promise<void> {
  if (typeof window === 'undefined')
    return Promise.reject(new Error('GSI can only be loaded in the browser'));
  if (window.google?.accounts?.id) return Promise.resolve();
  if (gsiLoadPromise) return gsiLoadPromise;

  const pending = new Promise<void>((resolve, reject) => {
    let settled = false;
    const finish = (error?: Error) => {
      if (settled) return;
      settled = true;
      window.clearTimeout(timer);
      if (error) reject(error);
      else if (window.google?.accounts?.id) resolve();
      else reject(new Error('Google Identity Services script did not initialize'));
    };
    const timer = window.setTimeout(() =>
      finish(new Error('Google Identity Services timed out')), 12000);

    const existing = document.querySelector<HTMLScriptElement>('script[data-asi-gsi="1"]');
    if (existing) {
      existing.addEventListener('load', () => finish(), { once: true });
      existing.addEventListener('error', () => finish(new Error('Failed to load Google Identity Services')), { once: true });
      return;
    }

    const script = document.createElement('script');
    script.src = 'https://accounts.google.com/gsi/client';
    script.async = true;
    script.defer = true;
    script.dataset.asiGsi = '1';
    script.onload = () => finish();
    script.onerror = () => {
      script.remove();
      finish(new Error('Failed to load Google Identity Services'));
    };
    document.head.appendChild(script);
  });
  gsiLoadPromise = pending.catch(error => {
    // Allow a subsequent retry after network/VPN connectivity changes.
    gsiLoadPromise = null;
    throw error;
  });
  return gsiLoadPromise;
}
