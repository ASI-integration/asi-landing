import type { InboundMessageEnvelope } from './types';

/** Stable numeric chat id for email sessions (matches orchestrator hash fallback). */
export function stableEmailChatId(envelope: InboundMessageEnvelope): number {
  const basis =
    envelope.email ??
    envelope.externalUserId ??
    `unknown:${envelope.channel}`;

  let h = 2166136261;
  for (let i = 0; i < basis.length; i++) {
    h ^= basis.charCodeAt(i);
    h = Math.imul(h, 16777619);
  }
  const out = h | 0;
  return out === 0 ? 1 : out;
}
