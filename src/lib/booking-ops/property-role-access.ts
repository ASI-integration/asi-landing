import { supabase } from '@/lib/supabase';

export type PropertyRole = 'owner' | 'manager' | 'operator';
export type PropertyPermission = 'manage_property' | 'perform_task' | 'view_owner_finance';

export type PropertyRoleEvidence = {
  userId: string;
  accountId: string;
  propertyId: string;
  accountRole: string | null | undefined;
  grantRole: string | null | undefined;
  grantAccountId: string | null | undefined;
  grantPropertyId: string | null | undefined;
  grantUserId: string | null | undefined;
};

const UUID = /^[0-9a-f]{8}-[0-9a-f]{4}-[1-8][0-9a-f]{3}-[89ab][0-9a-f]{3}-[0-9a-f]{12}$/i;
const PRIORITY: Record<PropertyRole, number> = { operator: 1, manager: 2, owner: 3 };

function isPropertyRole(value: unknown): value is PropertyRole {
  return value === 'owner' || value === 'manager' || value === 'operator';
}

/**
 * Both membership and explicit property assignment are mandatory.
 * Neither caller-controlled IDs nor an email allowlist authorize a property.
 * This server gate is necessary because the Supabase service role bypasses RLS.
 */
export function evaluatePropertyPermission(
  evidence: PropertyRoleEvidence,
  permission: PropertyPermission,
): boolean {
  if (!UUID.test(evidence.userId) || !UUID.test(evidence.accountId) || !UUID.test(evidence.propertyId)) {
    return false;
  }
  if (
    evidence.grantUserId !== evidence.userId ||
    evidence.grantAccountId !== evidence.accountId ||
    evidence.grantPropertyId !== evidence.propertyId ||
    !isPropertyRole(evidence.accountRole) ||
    !isPropertyRole(evidence.grantRole)
  ) {
    return false;
  }
  // The property grant must never elevate the user's account-wide role.
  if (PRIORITY[evidence.grantRole] > PRIORITY[evidence.accountRole]) return false;
  if (permission === 'view_owner_finance') return evidence.grantRole === 'owner';
  if (permission === 'manage_property') return PRIORITY[evidence.grantRole] >= PRIORITY.manager;
  return PRIORITY[evidence.grantRole] >= PRIORITY.operator;
}

type ScopedInput = { userId: string; accountId: string; propertyId: string };

/** Fail closed when any table, grant, auth identity or lookup is unavailable. */
export async function requirePropertyPermission(
  input: ScopedInput,
  permission: PropertyPermission,
): Promise<PropertyRole> {
  const denied = () => new Error('property_access_denied');
  if (![input.userId, input.accountId, input.propertyId].every((v) => UUID.test(v))) throw denied();
  try {
    const [member, property, grant] = await Promise.all([
      supabase.from('account_members').select('user_id,account_id,role')
        .eq('user_id', input.userId).eq('account_id', input.accountId).maybeSingle(),
      supabase.from('properties').select('id,account_id')
        .eq('id', input.propertyId).eq('account_id', input.accountId).maybeSingle(),
      supabase.from('property_access_grants').select('user_id,account_id,property_id,role')
        .eq('user_id', input.userId).eq('account_id', input.accountId)
        .eq('property_id', input.propertyId).maybeSingle(),
    ]);
    if (member.error || property.error || grant.error || !member.data || !property.data || !grant.data) {
      throw denied();
    }
    if (property.data.account_id !== input.accountId || property.data.id !== input.propertyId) {
      throw denied();
    }
    const evidence: PropertyRoleEvidence = {
      ...input,
      accountRole: member.data.role,
      grantRole: grant.data.role,
      grantUserId: grant.data.user_id,
      grantAccountId: grant.data.account_id,
      grantPropertyId: grant.data.property_id,
    };
    if (!evaluatePropertyPermission(evidence, permission) || !isPropertyRole(evidence.grantRole)) {
      throw denied();
    }
    return evidence.grantRole;
  } catch {
    throw denied();
  }
}
