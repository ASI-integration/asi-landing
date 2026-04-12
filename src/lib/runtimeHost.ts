/**
 * Hostname parsing aligned with `middleware.ts` for RU vs global routing and UI.
 */
export function hostnameFromHostHeader(rawHost: string): string {
  if (!rawHost) return '';
  try {
    return new URL(`http://${rawHost}`).hostname;
  } catch {
    return rawHost;
  }
}

/** RU deployment: dedicated .ru host or HOST_VARIANT=ru (proxy without correct Host). */
export function isRuRuntimeHost(hostname: string): boolean {
  return process.env.HOST_VARIANT === 'ru' || hostname.endsWith('.ru');
}
