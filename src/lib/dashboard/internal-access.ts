/** Server-only: who may see internal ops / debug dashboard tools. */

export function isDashboardInternalUser(email: string | null | undefined): boolean {
  if (!email?.trim()) return false;

  const nodeEnv = process.env.NODE_ENV ?? 'development';
  if (nodeEnv !== 'production') return true;

  const allowlist = (process.env.DASHBOARD_INTERNAL_EMAILS ?? '')
    .split(',')
    .map((entry) => entry.trim().toLowerCase())
    .filter(Boolean);

  return allowlist.includes(email.trim().toLowerCase());
}
