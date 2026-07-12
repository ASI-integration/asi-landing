import { randomUUID } from 'node:crypto';
import { supabase } from '@/lib/supabase';
import { communicationPolicyDefaults, computeLaunchReadiness, initializeModules, onboardingProgress, reportVerificationIssue } from './core';
import type { ModuleState, OnboardingData, OnboardingStep } from './types';

export async function loadOnboarding(accountId: string) {
  const result = await supabase.from('ops_v17_onboardings').select('*').eq('account_id', accountId).maybeSingle();
  if (result.error) throw new Error(result.error.message);
  return result.data as { id: string; account_id: string; data: OnboardingData; current_step: OnboardingStep; pilot_activated_at: string | null } | null;
}

async function audit(onboardingId: string, action: string, actorId: string, detail: Record<string, unknown> = {}) {
  const result = await supabase.from('ops_v17_audit_log').insert({ id: randomUUID(), onboarding_id: onboardingId, action, actor_id: actorId, detail });
  if (result.error) throw new Error(result.error.message);
}

export async function saveOnboardingStep(input: { accountId: string; actorId: string; step: OnboardingStep; patch: Partial<OnboardingData> }) {
  const existing = await loadOnboarding(input.accountId);
  const id = existing?.id ?? randomUUID();
  const data = { ...(existing?.data ?? {}), ...input.patch };
  const result = await supabase.from('ops_v17_onboardings').upsert({ id, account_id: input.accountId, current_step: input.step, data, progress: onboardingProgress(data).percentage, updated_at: new Date().toISOString() }, { onConflict: 'account_id' }).select('*').single();
  if (result.error) throw new Error(result.error.message);
  await audit(id, 'step_saved', input.actorId, { step: input.step });
  await synchronizeModules(id, data, input.actorId);
  return result.data;
}

export async function synchronizeModules(onboardingId: string, data: OnboardingData, actorId: string) {
  const current = await supabase.from('ops_v17_module_state').select('module_key,status,idempotency_key,detail').eq('onboarding_id', onboardingId);
  if (current.error) throw new Error(current.error.message);
  const modules = initializeModules(onboardingId, data, (current.data ?? []).map((m) => ({ key: m.module_key, status: m.status, idempotencyKey: m.idempotency_key, detail: m.detail })) as ModuleState[]);
  const rows = modules.map((m) => ({ onboarding_id: onboardingId, module_key: m.key, status: m.status, idempotency_key: m.idempotencyKey, detail: m.detail ?? null, updated_at: new Date().toISOString() }));
  const saved = await supabase.from('ops_v17_module_state').upsert(rows, { onConflict: 'onboarding_id,module_key' });
  if (saved.error) throw new Error(saved.error.message);
  await audit(onboardingId, 'modules_synchronized', actorId, { initialized: modules.filter((m) => m.status === 'initialized').map((m) => m.key) });
  return modules;
}

export async function getWorkspace(accountId: string) {
  const onboarding = await loadOnboarding(accountId);
  if (!onboarding) return null;
  const result = await supabase.from('ops_v17_module_state').select('module_key,status,idempotency_key,detail').eq('onboarding_id', onboarding.id);
  if (result.error) throw new Error(result.error.message);
  const modules = (result.data ?? []).map((m) => ({ key: m.module_key, status: m.status, idempotencyKey: m.idempotency_key, detail: m.detail })) as ModuleState[];
  return { onboarding, progress: onboardingProgress(onboarding.data), modules, readiness: computeLaunchReadiness(onboarding.data, modules, Boolean(onboarding.pilot_activated_at)), communicationDefaults: communicationPolicyDefaults };
}

export async function createVerificationIssue(input: { accountId: string; actorId: string; itemKey: string; propertyKey: string; notes?: string; blocking?: boolean }) {
  const onboarding = await loadOnboarding(input.accountId);
  if (!onboarding) throw new Error('onboarding_not_found');
  const taskId = randomUUID();
  const task = await supabase.from('ops_v17_maintenance_tasks').insert({ id: taskId, onboarding_id: onboarding.id, property_key: input.propertyKey, verification_key: input.itemKey, status: 'open', notes: input.notes ?? null });
  if (task.error) throw new Error(task.error.message);
  const verification = [...(onboarding.data.verification ?? []).filter((v) => !(v.key === input.itemKey && v.propertyKey === input.propertyKey)), reportVerificationIssue({ key: input.itemKey, propertyKey: input.propertyKey, status: 'pending', blocking: input.blocking, notes: input.notes }, taskId)];
  await saveOnboardingStep({ accountId: input.accountId, actorId: input.actorId, step: 'verification', patch: { verification } });
  await audit(onboarding.id, 'verification_issue_created', input.actorId, { taskId, itemKey: input.itemKey, propertyKey: input.propertyKey, notificationQueued: false });
  return { taskId };
}

export async function activatePilot(accountId: string, actorId: string) {
  const workspace = await getWorkspace(accountId);
  if (!workspace) throw new Error('onboarding_not_found');
  if (workspace.readiness.status !== 'ready_for_pilot') throw new Error('launch_blocked');
  const activatedAt = new Date().toISOString();
  const result = await supabase.from('ops_v17_onboardings').update({ pilot_activated_at: activatedAt, pilot_activated_by: actorId }).eq('id', workspace.onboarding.id);
  if (result.error) throw new Error(result.error.message);
  await audit(workspace.onboarding.id, 'pilot_activated', actorId, { activatedAt });
  return { activatedAt };
}

export async function bootstrapPilot(input: { accountId: string; actorId: string; confirm: boolean }) {
  const workspace = await getWorkspace(input.accountId);
  if (!workspace) throw new Error('onboarding_not_found');
  const records = await supabase.from('booking_ops_records').select('id,account_id,booking_id,ota_source,property_id,check_in_at,check_out_at,guest_phone,guest_email,guest_telegram,source_type,asi_reference').or(`account_id.eq.${input.accountId},account_id.is.null`).limit(500);
  if (records.error) throw new Error(records.error.message);
  const ambiguous = (records.data ?? []).filter((r) => !r.property_id || !r.check_in_at || !r.check_out_at || !(r.guest_phone || r.guest_email || r.guest_telegram));
  const eligible = (records.data ?? []).filter((r) => !ambiguous.some((a) => a.id === r.id));
  const preview = { accountId: input.accountId, modules: workspace.modules.filter((m) => m.status !== 'initialized').map((m) => m.key), inspectedRecords: records.data?.length ?? 0, eligibleRecords: eligible.length, ambiguousRecords: ambiguous.map((r) => ({ id: r.id, reference: r.asi_reference ?? null, missing: [!r.property_id && 'property', !r.check_in_at && 'check_in', !r.check_out_at && 'check_out', !(r.guest_phone || r.guest_email || r.guest_telegram) && 'guest_contact'].filter(Boolean) })), messagesWillBeSent: false };
  if (!input.confirm) return { dryRun: true, preview };
  for (const record of eligible) {
    const saved = await supabase.from('booking_ops_records').update({ account_id: input.accountId, source_type: record.source_type || 'manual', source_provider: record.ota_source || null, sync_status: record.booking_id ? 'imported' : 'local_only', created_by_actor: record.account_id ? undefined : input.actorId }).eq('id', record.id).or(`account_id.eq.${input.accountId},account_id.is.null`);
    if (saved.error) throw new Error(saved.error.message);
    if (record.booking_id) { const link = await supabase.from('reservation_source_links').upsert({ id: randomUUID(), account_id: input.accountId, booking_ops_record_id: record.id, provider: record.ota_source || 'legacy', external_reservation_id: record.booking_id, source_status: 'seen', metadata: { bootstrap: true }, last_seen_at: new Date().toISOString() }, { onConflict: 'account_id,provider,external_reservation_id' }); if (link.error) throw new Error(link.error.message); }
  }
  const modules = await synchronizeModules(workspace.onboarding.id, workspace.onboarding.data, input.actorId);
  await audit(workspace.onboarding.id, 'single_pilot_bootstrap', input.actorId, { preview, confirmed: true, messagesSent: false });
  return { dryRun: false, preview, modules };
}
