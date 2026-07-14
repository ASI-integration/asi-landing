import { readFileSync } from 'node:fs';
import { resolve } from 'node:path';
import { describe, expect, it } from 'vitest';

const migrationsDir = resolve(process.cwd(), 'supabase/migrations');
const targetMigration = readFileSync(
  resolve(migrationsDir, '20260528000001_telegram_guest_memory_foundation.sql'),
  'utf8',
);

const propertyKnowledgeColumns = [
  'location',
  'check_in_time',
  'check_out_time',
  'wifi_name',
  'wifi_password',
  'wifi_notes',
  'checkin_instructions',
  'door_code_notes',
  'access_notes',
  'parking_rules',
  'parking_paid_or_free',
  'parking_location_notes',
  'quiet_hours',
  'house_rules',
  'heating_notes',
  'emergency_contact_notes',
  'checkout_notes',
  'late_checkout_policy',
  'early_checkin_policy',
  'active',
  'created_at',
  'updated_at',
] as const;

function readMigration(name: string): string {
  return readFileSync(resolve(migrationsDir, name), 'utf8');
}

function expectColumnsAdded(sql: string, columns: readonly string[]): void {
  for (const column of columns) {
    expect(sql).toMatch(new RegExp(`ADD COLUMN IF NOT EXISTS\\s+${column}\\b`, 'i'));
  }
}

describe('telegram guest memory foundation migration', () => {
  it('backfills the full property knowledge schema before the seed runs', () => {
    const createIndex = targetMigration.indexOf('CREATE TABLE IF NOT EXISTS tg_property_knowledge');
    const alterIndex = targetMigration.indexOf('ALTER TABLE public.tg_property_knowledge');
    const seedIndex = targetMigration.indexOf('INSERT INTO tg_property_knowledge');
    const alterSql = targetMigration.slice(alterIndex, targetMigration.indexOf(';', alterIndex) + 1);

    expect(createIndex).toBeGreaterThanOrEqual(0);
    expect(alterIndex).toBeGreaterThan(createIndex);
    expect(seedIndex).toBeGreaterThan(alterIndex);
    expectColumnsAdded(alterSql, propertyKnowledgeColumns);
  });

  it('keeps earlier versions of the other guest-memory tables compatible', () => {
    const sessionsHistory = [
      readMigration('20260323000001_session_status_column.sql'),
      readMigration('20260324000002_create_telegram_conversation_tables.sql'),
      readMigration('20260507000001_telegram_conversation_context_v1.sql'),
    ].join('\n');
    const reservationHistory = readMigration('20260327000003_property_onboarding_columns.sql');
    const migrationsBeforeTarget = [
      sessionsHistory,
      reservationHistory,
      readMigration('20260328000001_stay_flow_readiness_columns.sql'),
      readMigration('20260328000002_stay_flow_pre_checkin_sent.sql'),
    ].join('\n');

    expectColumnsAdded(sessionsHistory, [
      'status',
      'status_updated_at',
      'conversation_context_v1',
      'guest_history_context_v1',
    ]);
    expectColumnsAdded(targetMigration, [
      'telegram_chat_id',
      'display_name',
      'stays_count',
      'trust_status',
      'last_seen_at',
      'booking_id',
      'phone',
      'guest_phone',
      'access_verified_at',
    ]);
    expect(reservationHistory).toContain('CREATE TABLE IF NOT EXISTS tg_guest_reservations');
    expect(migrationsBeforeTarget).not.toContain('CREATE TABLE IF NOT EXISTS tg_guest_identities');
  });

  it('defines reservation_ref before the owner chat cleanup uses it', () => {
    const cleanupMigration = readMigration(
      '20260531000002_unlink_test_telegram_from_owner_chat.sql',
    );
    const addColumnIndex = cleanupMigration.search(
      /ALTER TABLE public\.tg_guest_reservations\s+ADD COLUMN IF NOT EXISTS reservation_ref TEXT;/i,
    );
    const firstUpdateIndex = cleanupMigration.indexOf(
      'UPDATE public.tg_guest_reservations',
    );
    const laterPilotMigration = readMigration('20260623000001_pilot_readiness_v1.sql');

    expect(addColumnIndex).toBeGreaterThanOrEqual(0);
    expect(firstUpdateIndex).toBeGreaterThan(addColumnIndex);
    expect(laterPilotMigration).toMatch(
      /ADD COLUMN IF NOT EXISTS reservation_ref TEXT/i,
    );
    expect(cleanupMigration).not.toMatch(
      /\b(?:ALTER TABLE|UPDATE)\s+(?:tg_guest_reservations|tg_guest_identities)\b/i,
    );
  });
});
