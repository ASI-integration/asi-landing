/**
 * ASI-automation-core API client
 *
 * asi-landing is a thin UI/client layer. All operator domain data
 * (leads, status updates, notes, follow-ups) and location analysis
 * must flow through ASI-automation-core — not direct Supabase access.
 *
 * Required env vars (server-side only — never exposed to browser):
 *   ASI_CORE_BASE_URL    — base URL of ASI-automation-core (no trailing slash)
 *   ASI_CORE_API_SECRET  — shared secret; sent as  Authorization: Bearer <secret>
 *
 * ASI-automation-core must validate the Authorization header on:
 *   GET  /api/operator/leads
 *   PATCH /api/operator/leads
 *   POST /api/location-analyze
 */

// ─── Config ───────────────────────────────────────────────────────────────────

function baseUrl(): string {
  const url = process.env.ASI_CORE_BASE_URL;
  if (!url) throw new Error('[core-api] ASI_CORE_BASE_URL is not set');
  return url.replace(/\/$/, '');
}

function apiSecret(): string {
  const s = process.env.ASI_CORE_API_SECRET;
  if (!s) throw new Error('[core-api] ASI_CORE_API_SECRET is not set');
  return s;
}

function authHeaders(): Record<string, string> {
  return {
    'Content-Type': 'application/json',
    Authorization: `Bearer ${apiSecret()}`,
  };
}

// ─── Low-level helpers ────────────────────────────────────────────────────────

async function coreGet<T>(path: string, params?: URLSearchParams): Promise<T> {
  const url = `${baseUrl()}${path}${params ? `?${params.toString()}` : ''}`;
  const res = await fetch(url, { headers: authHeaders(), cache: 'no-store' });
  if (!res.ok) {
    const text = await res.text().catch(() => '');
    throw new Error(`[core-api] GET ${path} → ${res.status}: ${text}`);
  }
  return res.json() as Promise<T>;
}

async function corePatch<T>(path: string, body: unknown): Promise<T> {
  const url = `${baseUrl()}${path}`;
  const res = await fetch(url, {
    method: 'PATCH',
    headers: authHeaders(),
    body: JSON.stringify(body),
  });
  if (!res.ok) {
    const text = await res.text().catch(() => '');
    throw new Error(`[core-api] PATCH ${path} → ${res.status}: ${text}`);
  }
  return res.json() as Promise<T>;
}

async function corePost<T>(path: string, body: unknown): Promise<T> {
  const url = `${baseUrl()}${path}`;
  const res = await fetch(url, {
    method: 'POST',
    headers: authHeaders(),
    body: JSON.stringify(body),
  });
  if (!res.ok) {
    const text = await res.text().catch(() => '');
    throw new Error(`[core-api] POST ${path} → ${res.status}: ${text}`);
  }
  return res.json() as Promise<T>;
}

// ─── Lead types ───────────────────────────────────────────────────────────────

export interface CoreLead {
  id:              string;
  property_id:     string;
  reservation_id:  string | null;
  chat_id:         number | null;
  task_type:       string;
  task_status:     string;
  title:           string;
  description:     string | null;
  priority:        string;
  operator_note:   string | null;
  follow_up_at:    string | null;
  attachment_refs: unknown[] | null;
  source_event:    string | null;
  trigger_reason:  string | null;
  created_at:      string;
  updated_at:      string;
}

export interface LeadPatch {
  task_id:        string;
  task_status?:   string;
  operator_note?: string;
  follow_up_at?:  string;
}

// ─── Lead operations ──────────────────────────────────────────────────────────

/**
 * Fetch operator leads from ASI-automation-core.
 * Mirrors GET /api/operator/leads contract: { ok, leads }
 */
export async function fetchLeads(
  status?: string,
): Promise<{ ok: boolean; leads: CoreLead[] }> {
  const params = status ? new URLSearchParams({ status }) : undefined;
  return coreGet<{ ok: boolean; leads: CoreLead[] }>('/api/operator/leads', params);
}

/**
 * Update a lead in ASI-automation-core.
 * Mirrors PATCH /api/operator/leads contract: { ok, lead }
 */
export async function patchLead(
  patch: LeadPatch,
): Promise<{ ok: boolean; lead: CoreLead }> {
  return corePatch<{ ok: boolean; lead: CoreLead }>('/api/operator/leads', patch);
}

// ─── Location analysis ────────────────────────────────────────────────────────

/**
 * Request location analysis from ASI-automation-core.
 * Mirrors POST /api/location-analyze contract:
 *   { source, address, lat, lon, score, band, bandLabel, metrics, audienceScores }
 */
export async function analyzeLocation(
  address: string,
  lat?: number | null,
  lon?: number | null,
): Promise<Record<string, unknown>> {
  return corePost<Record<string, unknown>>('/api/location-analyze', { address, lat, lon });
}
