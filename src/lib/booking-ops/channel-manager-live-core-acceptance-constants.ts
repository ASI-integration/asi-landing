/**
 * Deterministic Channel Manager Live Core acceptance identity constants.
 * Shared by harness, recovery, and create-time ownership context.
 */

export const LIVE_CORE_ACCEPTANCE_HARNESS = 'channel_manager_live_core_v1' as const;
export const LIVE_CORE_ACCEPTANCE_LEAD_ID = 'acceptance:channel_manager_live_core_v1';
export const LIVE_CORE_ACCEPTANCE_PROPERTY_ID = 'asi-live-core-acceptance-v1';
export const LIVE_CORE_ACCEPTANCE_EXTERNAL_OBJECT_ID = 'asi-lc-accept-obj-v1';
export const LIVE_CORE_ACCEPTANCE_EXTERNAL_BOOKING_ID = 'asi-lc-accept-book-v1';
export const LIVE_CORE_ACCEPTANCE_SAFE_ACCESS_REF = 'operator:acceptance-harness-v1';
export const LIVE_CORE_ACCEPTANCE_GUEST_NAME = 'Тестовый Гость ASI';
export const LIVE_CORE_ACCEPTANCE_OBJECT_TITLE = 'ASI Live Core Acceptance Object';
export const LIVE_CORE_ACCEPTANCE_OBJECT_CITY = 'Тверь';
export const LIVE_CORE_ACCEPTANCE_INTAKE_SOURCE = 'channel_manager_placeholder' as const;
export const LIVE_CORE_ACCEPTANCE_INTAKE_IDEMPOTENCY_KEY =
  `ext:${LIVE_CORE_ACCEPTANCE_INTAKE_SOURCE}:${LIVE_CORE_ACCEPTANCE_EXTERNAL_BOOKING_ID}`;

export const HARNESS_IDENTITY_COLLISION = 'harness_identity_collision';
export const HARNESS_SCOPE_COLLISION = 'harness_scope_collision';

export const LIVE_CORE_RECOVERY_CONFIRM_PHRASE = 'CLEAN_SYNTHETIC_LIVE_CORE_ACCEPTANCE_V1';

export const LIVE_CORE_PRESERVED_CONTOUR = {
  ownerSetupId: '39e6b608-a6d9-413f-9b4d-02d1e4d81890',
  propertySetupId: '1a14e03b-465d-4000-be05-c06f452818a1',
  connectionId: '9f97a660-81f8-4583-9125-f95216f8dd03',
} as const;
