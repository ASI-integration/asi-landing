function parseEmailList(raw: string | undefined): string[] {
  return String(raw ?? '')
    .split(/[,;\s]+/)
    .map((part) => part.trim().toLowerCase())
    .filter((email) => email.includes('@'));
}

/** Owner Development Console allowlist. Values must never be logged or sent to the browser. */
export function developmentOwnerAllowlist(): Set<string> {
  const emails = new Set<string>();
  for (const email of parseEmailList(process.env.ASI_DEVELOPMENT_OWNER_EMAILS)) {
    emails.add(email);
  }
  return emails;
}

/**
 * Strict owner-only access for /dashboard/development.
 * - Production: deny-by-default when ASI_DEVELOPMENT_OWNER_EMAILS is empty.
 * - No *@asi-global.ru fallback.
 * - CRM / OPS operator membership alone is never enough.
 * - Comparison is case-insensitive.
 */
export function isDevelopmentOwnerEmail(email: string | null | undefined): boolean {
  const normalized = String(email ?? '').trim().toLowerCase();
  if (!normalized) return false;

  const allowlist = developmentOwnerAllowlist();
  if (allowlist.size === 0) {
    return false;
  }

  return allowlist.has(normalized);
}
