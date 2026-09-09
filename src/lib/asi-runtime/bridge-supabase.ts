import 'server-only';
import { createClient, type SupabaseClient } from '@supabase/supabase-js';

const BRIDGE_URL_ENV = 'ASI_RUNTIME_BRIDGE_SUPABASE_URL';
const BRIDGE_KEY_ENV = 'ASI_RUNTIME_BRIDGE_SUPABASE_SERVICE_ROLE_KEY';
const BRIDGE_SCHEMA_ENV = 'ASI_RUNTIME_BRIDGE_SUPABASE_SCHEMA';

/** Isolated Bridge project / production default. */
export const RUNTIME_BRIDGE_DEFAULT_SCHEMA = 'public';
/**
 * Free-tier staging exception: Bridge shares the staging Supabase project but uses
 * dedicated runtime_bridge schema. Production requires isolated Bridge storage.
 */
export const RUNTIME_BRIDGE_STAGING_SCHEMA = 'runtime_bridge';

export type RuntimeBridgeSupabaseSchema =
  | typeof RUNTIME_BRIDGE_DEFAULT_SCHEMA
  | typeof RUNTIME_BRIDGE_STAGING_SCHEMA;

export class RuntimeBridgeSupabaseConfigError extends Error {
  readonly code = 'bridge_not_configured';
  readonly status = 503;
  readonly messageRu = 'Runtime Bridge не настроен.';

  constructor() {
    super('bridge_not_configured');
    this.name = 'RuntimeBridgeSupabaseConfigError';
  }
}

function normalizeSupabaseUrl(url: string): string {
  const parsed = new URL(url);
  const loopback = ['localhost', '127.0.0.1', '[::1]'].includes(parsed.hostname);
  if (parsed.protocol !== 'https:' && !(loopback && parsed.protocol === 'http:')) {
    throw new Error('invalid_bridge_url');
  }
  if (parsed.username || parsed.password || parsed.search || parsed.hash) {
    throw new Error('invalid_bridge_url');
  }
  if (parsed.pathname.replace(/\/+$/, '') === '/rest/v1') {
    parsed.pathname = '/';
  }
  return parsed.toString().replace(/\/$/, '');
}

export function resolveRuntimeBridgeSupabaseSchema(
  env: Readonly<Record<string, string | undefined>> = process.env,
): RuntimeBridgeSupabaseSchema | null {
  const raw = env[BRIDGE_SCHEMA_ENV]?.trim() ?? '';
  if (!raw || raw === RUNTIME_BRIDGE_DEFAULT_SCHEMA) return RUNTIME_BRIDGE_DEFAULT_SCHEMA;
  if (raw === RUNTIME_BRIDGE_STAGING_SCHEMA) return RUNTIME_BRIDGE_STAGING_SCHEMA;
  return null;
}

export function readRuntimeBridgeSupabaseConfig(
  env: Readonly<Record<string, string | undefined>> = process.env,
):
  | { ok: true; url: string; key: string; schema: RuntimeBridgeSupabaseSchema }
  | { ok: false } {
  const urlRaw = env[BRIDGE_URL_ENV]?.trim() ?? '';
  const key = env[BRIDGE_KEY_ENV]?.trim() ?? '';
  const schema = resolveRuntimeBridgeSupabaseSchema(env);
  if (!urlRaw || !key || schema == null) return { ok: false };
  try {
    const url = normalizeSupabaseUrl(urlRaw);
    return { ok: true, url, key, schema };
  } catch {
    return { ok: false };
  }
}

export function isRuntimeBridgeSupabaseConfigured(): boolean {
  return readRuntimeBridgeSupabaseConfig().ok;
}

let _client: SupabaseClient | null = null;
let _fingerprint: string | null = null;

function getRuntimeBridgeSupabaseClient(): SupabaseClient {
  const config = readRuntimeBridgeSupabaseConfig();
  if (!config.ok) {
    throw new RuntimeBridgeSupabaseConfigError();
  }
  const fingerprint = `${config.url}\0${config.key}\0${config.schema}`;
  if (!_client || _fingerprint !== fingerprint) {
    _client = createClient(config.url, config.key, {
      auth: { persistSession: false },
      db: { schema: config.schema },
    }) as SupabaseClient;
    _fingerprint = fingerprint;
  }
  return _client;
}

/** Server-only isolated Runtime Bridge Supabase client. Never use for app auth/CRM. */
export const runtimeBridgeSupabase = new Proxy({} as SupabaseClient, {
  get(_, prop) {
    const value = getRuntimeBridgeSupabaseClient()[prop as keyof SupabaseClient];
    return typeof value === 'function' ? value.bind(getRuntimeBridgeSupabaseClient()) : value;
  },
});

/** Test helper — clears the lazy singleton between cases. */
export function __resetRuntimeBridgeSupabaseForTests(): void {
  _client = null;
  _fingerprint = null;
}
