import 'server-only';
import { createHash, timingSafeEqual } from 'node:crypto';

export type RuntimeBridgeRole = 'chat' | 'owner' | 'runner';

const TOKEN_ENV: Record<RuntimeBridgeRole, string> = {
  chat: 'ASI_RUNTIME_BRIDGE_CHAT_TOKEN',
  owner: 'ASI_RUNTIME_BRIDGE_OWNER_TOKEN',
  runner: 'ASI_RUNTIME_BRIDGE_RUNNER_TOKEN',
};

function digest(value: string): Buffer {
  return createHash('sha256').update(value, 'utf8').digest();
}

export function isRuntimeBridgeAuthorized(request: Request, role: RuntimeBridgeRole): boolean {
  const expected = process.env[TOKEN_ENV[role]]?.trim() ?? '';
  const configured = Object.values(TOKEN_ENV).map((name) => process.env[name]?.trim() ?? '');
  if (configured.some((token) => token.length < 32)) return false;
  if (new Set(configured.map((token) => digest(token).toString('hex'))).size !== configured.length) return false;

  const header = request.headers.get('authorization') ?? '';
  const match = /^Bearer ([^\s]+)$/.exec(header);
  if (!match || match[1].length < 32) return false;

  return timingSafeEqual(digest(expected), digest(match[1]));
}

export function getRuntimeBridgeClientId(): string | null {
  const value = process.env.ASI_RUNTIME_BRIDGE_CLIENT_ID?.trim();
  return value && /^[a-z0-9][a-z0-9._:-]{2,99}$/i.test(value) ? value : null;
}
