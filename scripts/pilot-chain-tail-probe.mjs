#!/usr/bin/env node
/**
 * Production probes for Pilot Automation Spine v1 tails:
 * - crm_events constraint for pilot-chain audit types
 * - UI bundle marker on /dashboard/crm
 * - acceptance contact shape for next-step links
 */
import { readFileSync } from 'node:fs';
import { resolve } from 'node:path';
import { createClient } from '@supabase/supabase-js';

function loadEnvLocal() {
  const raw = readFileSync(resolve('.env.local'), 'utf8');
  const env = {};
  for (const line of raw.split(/\r?\n/)) {
    const m = line.match(/^([A-Z0-9_]+)=(.*)$/);
    if (m) env[m[1]] = m[2];
  }
  return env;
}

const env = loadEnvLocal();
const supabaseUrl = (env.NEXT_PUBLIC_SUPABASE_URL || '').replace(/\/rest\/v1\/?$/, '');
const serviceKey = env.SUPABASE_SERVICE_ROLE_KEY || '';
const supabase = createClient(supabaseUrl, serviceKey, {
  auth: { persistSession: false, autoRefreshToken: false },
});

const PILOT_TYPES = [
  'lead_to_object_created',
  'object_to_channel_manager_prepared',
  'ops_case_created',
  'skipped_existing_object',
  'skipped_existing_ops',
];

function extractObjectId(notes) {
  const m = String(notes ?? '').match(/object_id=([^\s\n|]+)/);
  return m?.[1] ?? null;
}

async function probeConstraint(contactId) {
  const results = {};
  for (const eventType of PILOT_TYPES) {
    const { data, error } = await supabase
      .from('crm_events')
      .insert({
        contact_id: contactId,
        event_type: eventType,
        message_text: `probe ${eventType}`,
        metadata: { integration: 'pilot_chain', probe: true },
      })
      .select('id')
      .single();
    if (error) {
      results[eventType] = { ok: false, error: error.message };
      continue;
    }
    results[eventType] = { ok: true };
    await supabase.from('crm_events').delete().eq('id', data.id);
  }
  return results;
}

async function probeUiBundle() {
  const version = await fetch('https://asi-global.ru/api/version').then((r) => r.json());
  const html = await fetch('https://asi-global.ru/dashboard/crm').then((r) => r.text());
  const chunks = [...html.matchAll(/\/_next\/static\/chunks\/[^"']+\.js/g)].map((m) => m[0]);
  const markers = [];
  for (const chunk of chunks) {
    const js = await fetch(`https://asi-global.ru${chunk}`).then((r) => r.text());
    if (js.includes('Следующий шаг пилота')) markers.push({ marker: 'title', chunk });
    if (js.includes('Открыть настройку объекта')) markers.push({ marker: 'object_setup', chunk });
    if (js.includes('Открыть OPS')) markers.push({ marker: 'ops', chunk });
  }
  return { sha: version.sha, markers };
}

async function main() {
  const version = await fetch('https://asi-global.ru/api/version').then((r) => r.json());
  console.log('PRODUCTION_SHA', version.sha);

  const ui = await probeUiBundle();
  console.log('UI_BUNDLE', ui);

  const { data: rows, error } = await supabase
    .from('crm_contacts')
    .select('id,name,notes,status')
    .ilike('name', 'ASI_PILOT_CHAIN_ACCEPTANCE_%')
    .order('created_at', { ascending: false })
    .limit(1);
  if (error) throw error;
  const row = rows?.[0];
  if (!row) {
    console.log('PROBE_STATUS=no_acceptance_contact');
    process.exit(1);
  }

  const objectId = extractObjectId(row.notes);
  console.log('ACCEPTANCE_CONTACT', {
    id: row.id,
    name: row.name,
    status: row.status,
    objectId,
    expectedObjectHref: objectId ? `/dashboard/properties/prepare?propertyId=${encodeURIComponent(objectId)}` : null,
    expectedCmHref: objectId ? `/dashboard/channel-connections?objectId=${objectId}&contactId=${row.id}` : null,
    expectedOpsHref: '/dashboard/ops',
  });

  const { count } = await supabase
    .from('crm_events')
    .select('id', { count: 'exact', head: true })
    .eq('contact_id', row.id)
    .in('event_type', PILOT_TYPES);
  console.log('EXISTING_AUDIT_EVENTS', count ?? 0);

  const constraint = await probeConstraint(row.id);
  const constraintOk = Object.values(constraint).every((r) => r.ok);
  console.log('CONSTRAINT_PROBE', { constraintOk, constraint });

  if (!ui.markers.some((m) => m.marker === 'title')) {
    console.log('PROBE_STATUS=ui_marker_missing');
    process.exit(3);
  }
  if (!constraintOk) {
    console.log('PROBE_STATUS=constraint_blocked');
    process.exit(2);
  }
  console.log('PROBE_STATUS=ok');
}

main().catch((err) => {
  console.error('PROBE_FAIL', err);
  process.exit(1);
});
