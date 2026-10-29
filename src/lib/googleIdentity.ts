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

export function loadGoogleIdentityServices(): Promise<void> {
  if (typeof window === 'undefined') return Promise.reject(new Error('GSI can only be loaded in the browser'));
  if (window.google?.accounts?.id) return Promise.resolve();
  if (gsiLoadPromise) return gsiLoadPromise;

  // Browser/privacy extensions can stall external scripts without firing onerror.
  // A finite timeout and cache reset lets users retry instead of hanging forever.
  gsiLoadPromise = new Promise<void>((resolve, reject) => {
    const existing = document.querySelector<HTMLScriptElement>('script[data-asi-gsi="1"]');
    const script = existing || document.createElement('script');
    let done = false;
    const finish = (error?: Error) => {
      if (done) return;
      done = true;
      window.clearTimeout(timer);
      script.removeEventListener('load', onLoad);
      script.removeEventListener('error', onError);
      if (error) {
        gsiLoadPromise = null;
        script.remove();
        reject(error);
      } else resolve();
    };
    const onLoad = () => finish(window.google?.accounts?.id
      ? undefined : new Error('Google Identity Services unavailable'));
    const onError = () => finish(new Error('Failed to load Google Identity Services'));
    const timer = window.setTimeout(() => finish(new Error('Google Identity Services timeout')), 10000);
    script.addEventListener('load', onLoad, { once: true });
    script.addEventListener('error', onError, { once: true });

    if (!existing) {
      script.src = 'https://accounts.google.com/gsi/client';
      script.async = true;
      script.defer = true;
      script.dataset.asiGsi = '1';
      document.head.appendChild(script);
    }
  });
  return gsiLoadPromise;
}
