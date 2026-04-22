import * as fs from 'fs';
import * as path from 'path';
import { randomUUID } from 'crypto';
import type { VoiceChannel, VoiceSession, VoiceSessionState } from './types';

const isTest = process.env.NODE_ENV === 'test';

function defaultStateDir(): string {
  const env =
    process.env.COMM_STATE_DIR ??
    process.env.CONVERSATION_SESSION_DIR ??
    process.env.SESSION_STORE_DIR ??
    process.env.STATE_DIR;
  if (env && String(env).trim()) return String(env);
  return path.join(process.cwd(), '.asi-comm-state');
}

const BASE_DIR = defaultStateDir();
const VOICE_SESSIONS_PATH = path.join(BASE_DIR, 'asi-comm-voice-sessions.json');

type StoreShape = {
  sessionsById: Record<string, VoiceSession>;
  activeSessionIdByActorKey: Record<string, string>;
};

let loaded = false;
let cache: StoreShape = { sessionsById: {}, activeSessionIdByActorKey: {} };

function nowIso(): string {
  return new Date().toISOString();
}

function safeMkdirp(dir: string): void {
  try {
    fs.mkdirSync(dir, { recursive: true });
  } catch {
    // best-effort
  }
}

function loadOnce(): void {
  if (loaded || isTest) {
    loaded = true;
    return;
  }
  loaded = true;
  safeMkdirp(BASE_DIR);
  try {
    if (!fs.existsSync(VOICE_SESSIONS_PATH)) return;
    const raw = fs.readFileSync(VOICE_SESSIONS_PATH, 'utf-8');
    const parsed = JSON.parse(raw) as Partial<StoreShape>;
    cache = {
      sessionsById: parsed.sessionsById ?? {},
      activeSessionIdByActorKey: parsed.activeSessionIdByActorKey ?? {},
    };
  } catch {
    cache = { sessionsById: {}, activeSessionIdByActorKey: {} };
  }
}

function persist(): void {
  if (isTest) return;
  safeMkdirp(BASE_DIR);
  try {
    fs.writeFileSync(VOICE_SESSIONS_PATH, JSON.stringify(cache), 'utf-8');
  } catch {
    // best-effort
  }
}

function actorKey(channel: VoiceChannel, actorId?: string): string {
  return `${channel}:${String(actorId ?? 'anonymous')}`;
}

export function getOrCreateVoiceSession(params: {
  channel: VoiceChannel;
  actorId?: string;
  initialState?: VoiceSessionState;
}): VoiceSession {
  loadOnce();
  const key = actorKey(params.channel, params.actorId);
  const existingId = cache.activeSessionIdByActorKey[key];
  const existing = existingId ? cache.sessionsById[existingId] : undefined;
  if (existing) return existing;

  const ts = nowIso();
  const session: VoiceSession = {
    voiceSessionId: randomUUID(),
    channel: params.channel,
    actorId: params.actorId,
    state: params.initialState ?? 'listening',
    createdAt: ts,
    updatedAt: ts,
  };
  cache.sessionsById[session.voiceSessionId] = session;
  cache.activeSessionIdByActorKey[key] = session.voiceSessionId;
  persist();
  return session;
}

export function updateVoiceSession(voiceSessionId: string, patch: Partial<VoiceSession>): VoiceSession {
  loadOnce();
  const cur = cache.sessionsById[voiceSessionId];
  if (!cur) throw new Error('voice_session_not_found');
  const updated: VoiceSession = { ...cur, ...patch, updatedAt: nowIso() };
  cache.sessionsById[voiceSessionId] = updated;
  persist();
  return updated;
}

/** @internal tests only */
export function __resetVoiceSessionStoreForTests(): void {
  loaded = true;
  cache = { sessionsById: {}, activeSessionIdByActorKey: {} };
}

