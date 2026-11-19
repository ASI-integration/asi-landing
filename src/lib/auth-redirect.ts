/** Reject protocol-relative and encoded cross-origin redirects after login. */
export function safeLoginRedirect(value: string | null): string {
  const fallback = '/dashboard';
  if (!value) return fallback;

  try {
    // Some routers normalize backslashes or decode percent escapes more than once.
    // Refuse every ambiguous form rather than sending an authenticated user away.
    let candidate = value;
    for (let i = 0; i < 4; i += 1) {
      if (
        !candidate.startsWith('/') ||
        candidate.startsWith('//') ||
        candidate.includes('\\') ||
        /[\u0000-\u001f\u007f]/.test(candidate)
      ) {
        return fallback;
      }
      const decoded = decodeURIComponent(candidate);
      if (decoded === candidate) break;
      candidate = decoded;
    }

    const parsed = new URL(value, 'https://asi-login.invalid');
    if (parsed.origin !== 'https://asi-login.invalid') return fallback;
    return value;
  } catch {
    return fallback;
  }
}
