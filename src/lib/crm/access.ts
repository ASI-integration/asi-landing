function parseEmailList(raw: string | undefined): string[] {
  return String(raw ?? '')
    .split(/[,;\s]+/)
    .map((part) => part.trim().toLowerCase())
    .filter((email) => email.includes('@'));
}

export function crmOperatorAllowlist(): Set<string> {
  const emails = new Set<string>();
  for (const email of parseEmailList(process.env.CRM_OPERATOR_EMAILS)) {
    emails.add(email);
  }
  for (const email of parseEmailList(process.env.OPERATOR_EMAIL)) {
    emails.add(email);
  }
  return emails;
}

export function isCrmOperatorEmail(email: string | null | undefined): boolean {
  const normalized = String(email ?? '').trim().toLowerCase();
  if (!normalized) return false;

  const allowlist = crmOperatorAllowlist();
  if (allowlist.size > 0) {
    return allowlist.has(normalized);
  }

  return false;
}

export function opsAdminAllowlist(): Set<string> {
  const emails = new Set<string>();
  for (const email of parseEmailList(process.env.OPS_ADMIN_EMAILS)) {
    emails.add(email);
  }
  return emails;
}

/** OPS manual task creation — stricter than operator access. */
export function isOpsAdminEmail(email: string | null | undefined): boolean {
  const normalized = String(email ?? '').trim().toLowerCase();
  if (!normalized) return false;

  const adminList = opsAdminAllowlist();
  if (adminList.size > 0) {
    return adminList.has(normalized);
  }

  return false;
}
