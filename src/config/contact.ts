/**
 * Public support email for mailto links and legal copy.
 * `NEXT_PUBLIC_*` is inlined at build time; set it on the server and rebuild to override.
 */
const DEFAULT_SUPPORT = 'support@asi-global.ru';

/** Reject mistaken env values (setup instructions pasted into .env, example.com, etc.). */
function sanitizedContactEmailFromEnv(raw: string | undefined): string {
  const v = (raw ?? '').trim();
  if (!v) return '';
  const lower = v.toLowerCase();
  if (
    lower.includes('укажите') ||
    lower.includes('.env.local') ||
    lower.includes('next_public_contact_email') ||
    lower === 'pilot-intake@example.com' ||
    (lower.includes('@') && lower.endsWith('@example.com'))
  ) {
    return '';
  }
  return v;
}

const fromEnv = sanitizedContactEmailFromEnv(process.env.NEXT_PUBLIC_CONTACT_EMAIL);
export const productSupportEmail = fromEnv || DEFAULT_SUPPORT;
