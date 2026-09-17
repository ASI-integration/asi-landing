/**
 * Generic, vertical-agnostic integration acceptance model.
 *
 * Deliberately separate from src/lib/booking-ops/channel-manager-access-import.ts,
 * which is a real, richer, Russian-labeled state machine scoped to one
 * property's channel-manager connection. This model is account-level and
 * vertical-agnostic — "channel_manager", "access_system", or any future
 * "other" integration type all satisfy the same contract, so the state
 * machine that gates integration_ready never needs to know which vertical
 * produced the acceptance.
 */

export const INTEGRATION_REQUIREMENT_TYPES = [
  'channel_manager',
  'pms',
  'access_system',
  'event_ingestion',
  'other',
] as const;
export type IntegrationRequirementType = (typeof INTEGRATION_REQUIREMENT_TYPES)[number];

export const INTEGRATION_REQUIREMENT_STATUSES = [
  'pending',
  'connecting',
  'connected',
  'verification_failed',
  'accepted',
] as const;
export type IntegrationRequirementStatus = (typeof INTEGRATION_REQUIREMENT_STATUSES)[number];

export type IntegrationRequirement = {
  id: string;
  accountId: string;
  type: IntegrationRequirementType;
  label: string;
  required: boolean;
  status: IntegrationRequirementStatus;
  connectedAt: string | null;
  verifiedAt: string | null;
  failureReason: string | null;
  acceptanceEvidence: Record<string, unknown> | null;
  createdAt: string;
  updatedAt: string;
};

/**
 * An account is integration-ready only when every REQUIRED requirement has
 * been explicitly accepted. An account with zero defined requirements is
 * never "ready" by accident — fail closed rather than vacuously true.
 */
export function isAccountIntegrationReady(requirements: IntegrationRequirement[]): boolean {
  const required = requirements.filter((r) => r.required);
  if (required.length === 0) return false;
  return required.every((r) => r.status === 'accepted');
}
