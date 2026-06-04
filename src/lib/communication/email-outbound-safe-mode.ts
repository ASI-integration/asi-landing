/**
 * Email outbound safety defaults for guest communication MVP.
 *
 * By default inbound email is processed and a reply draft is produced for the
 * operator — nothing is sent to the guest unless explicitly enabled.
 */

function envTruthy(name: string): boolean {
  const v = process.env[name]?.trim().toLowerCase();
  return v === '1' || v === 'true' || v === 'yes';
}

function envFalsy(name: string): boolean {
  const v = process.env[name]?.trim().toLowerCase();
  return v === '0' || v === 'false' || v === 'no';
}

/** Explicit opt-in to SMTP-deliver guest replies. Default: off. */
export function isEmailAutoSendEnabled(): boolean {
  return envTruthy('EMAIL_AUTO_SEND');
}

/** When true, compute reply drafts and operator output without guest send. Default: on. */
export function isEmailDraftOnly(): boolean {
  if (envFalsy('EMAIL_DRAFT_ONLY')) return false;
  if (envTruthy('EMAIL_DRAFT_ONLY')) return true;
  return true;
}

export function shouldSuppressEmailOutbound(): boolean {
  if (isEmailDraftOnly()) return true;
  return !isEmailAutoSendEnabled();
}

export type EmailOutboundMode = 'draft_only' | 'auto_send' | 'disabled';

export function getEmailOutboundMode(): EmailOutboundMode {
  if (isEmailDraftOnly()) return 'draft_only';
  if (isEmailAutoSendEnabled()) return 'auto_send';
  return 'disabled';
}
