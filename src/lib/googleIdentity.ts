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

  gsiLoadPromise = new Promise<void>((resolve, reject) => {
    const existing = document.querySelector<HTMLScriptElement>('script[data-asi-gsi="1"]');
    if (existing) {
      existing.addEventListener('load', () => resolve(), { once: true });
      existing.addEventListener('error', () => reject(new Error('Failed to load Google Identity Services')), { once: true });
      return;
    }

    const s = document.createElement('script');
    s.src = 'https://accounts.google.com/gsi/client';
    s.async = true;
    s.defer = true;
    s.dataset.asiGsi = '1';
    s.onload = () => resolve();
    s.onerror = () => reject(new Error('Failed to load Google Identity Services'));
    document.head.appendChild(s);
  });

  return gsiLoadPromise;
}

