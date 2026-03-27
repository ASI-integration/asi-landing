/**
 * One-shot migration runner for the Supabase production database.
 *
 * WHY THIS EXISTS:
 *   The Supabase JS client (PostgREST) does not support DDL. This endpoint
 *   calls the Supabase Management API (api.supabase.com) which does, using
 *   a Personal Access Token (PAT) the caller supplies.
 *
 * HOW TO USE (one-time, then remove this route):
 *   1. Get your PAT from: https://app.supabase.com/account/tokens
 *   2. Deploy this branch to a Vercel preview or production.
 *   3. Call: GET https://{host}/api/admin/run-migrations
 *            Header: x-mgmt-token: {your PAT}
 *   4. Verify the response — all steps should show status "ok".
 *   5. Delete this file after the migration is confirmed applied.
 *
 * SECURITY:
 *   The endpoint requires x-mgmt-token (a Supabase PAT). Without it the
 *   request is rejected 401. The PAT is only used for DDL and is never
 *   stored or logged.
 */

import { NextResponse } from 'next/server';

const PROJECT_REF = 'jwinifeienvzejofmbua';
const MGMT_API    = `https://api.supabase.com/v1/projects/${PROJECT_REF}/database/query`;

// ─── Migration statements ─────────────────────────────────────────────────────
// Each entry: { label, sql }. Executed in order. All DDL uses IF NOT EXISTS /
// ADD COLUMN IF NOT EXISTS so the runner is idempotent and safe to re-run.

const MIGRATIONS: { label: string; sql: string }[] = [
  // ── 20260322000001 (partial — sessions + turns already exist) ────────────
  {
    label: '20260322 / tg_processed_updates',
    sql: `
      CREATE TABLE IF NOT EXISTS tg_processed_updates (
        update_id    BIGINT      PRIMARY KEY,
        processed_at TIMESTAMPTZ NOT NULL DEFAULT NOW()
      );
    `,
  },
  {
    label: '20260322 / tg_escalation_events',
    sql: `
      CREATE TABLE IF NOT EXISTS tg_escalation_events (
        id         UUID        PRIMARY KEY DEFAULT gen_random_uuid(),
        chat_id    BIGINT      NOT NULL,
        update_id  BIGINT,
        reason     TEXT        NOT NULL,
        category   TEXT,
        summary    TEXT,
        created_at TIMESTAMPTZ NOT NULL DEFAULT NOW()
      );
      CREATE INDEX IF NOT EXISTS idx_tg_escalation_events_chat_created
        ON tg_escalation_events (chat_id, created_at DESC);
    `,
  },
  {
    label: '20260322 / tg_outbound_failures',
    sql: `
      CREATE TABLE IF NOT EXISTS tg_outbound_failures (
        id           UUID        PRIMARY KEY DEFAULT gen_random_uuid(),
        chat_id      BIGINT      NOT NULL,
        update_id    BIGINT,
        error_detail TEXT,
        retry_count  INT         NOT NULL DEFAULT 0,
        created_at   TIMESTAMPTZ NOT NULL DEFAULT NOW(),
        retried_at   TIMESTAMPTZ
      );
      CREATE INDEX IF NOT EXISTS idx_tg_outbound_failures_chat_created
        ON tg_outbound_failures (chat_id, created_at DESC);
    `,
  },

  // ── 20260323000001 / backfill + index (column already exists) ───────────
  {
    label: '20260323 / session_status backfill + index',
    sql: `
      ALTER TABLE tg_conversation_sessions
        ADD COLUMN IF NOT EXISTS status             TEXT        NOT NULL DEFAULT 'inquiry',
        ADD COLUMN IF NOT EXISTS status_updated_at  TIMESTAMPTZ;

      UPDATE tg_conversation_sessions
        SET status_updated_at = updated_at
        WHERE status_updated_at IS NULL;

      CREATE INDEX IF NOT EXISTS idx_tg_conv_sess_status
        ON tg_conversation_sessions (status, status_updated_at)
        WHERE status = 'payment_pending';
    `,
  },

  // ── 20260326000001 / Phase 2 comms tables ───────────────────────────────
  {
    label: '20260326a / tg_guest_identities',
    sql: `
      CREATE TABLE IF NOT EXISTS tg_guest_identities (
        id                UUID        PRIMARY KEY DEFAULT gen_random_uuid(),
        telegram_chat_id  BIGINT      NOT NULL UNIQUE,
        telegram_user_id  BIGINT,
        guest_id          TEXT        NOT NULL,
        first_name        TEXT,
        last_name         TEXT,
        phone             TEXT,
        email             TEXT,
        lang_hint         TEXT,
        created_at        TIMESTAMPTZ NOT NULL DEFAULT NOW(),
        updated_at        TIMESTAMPTZ NOT NULL DEFAULT NOW()
      );
      CREATE INDEX IF NOT EXISTS idx_tg_guest_identities_guest_id
        ON tg_guest_identities (guest_id);
    `,
  },
  {
    label: '20260326a / tg_conversation_context',
    sql: `
      CREATE TABLE IF NOT EXISTS tg_conversation_context (
        chat_id          BIGINT      PRIMARY KEY,
        last_intent      TEXT,
        guest_name       TEXT,
        reservation_id   TEXT,
        booking_draft    JSONB,
        last_message_at  TIMESTAMPTZ NOT NULL DEFAULT NOW(),
        updated_at       TIMESTAMPTZ NOT NULL DEFAULT NOW()
      );
    `,
  },
  {
    label: '20260326a / tg_guest_reservations',
    sql: `
      CREATE TABLE IF NOT EXISTS tg_guest_reservations (
        id               UUID        PRIMARY KEY DEFAULT gen_random_uuid(),
        reservation_ref  TEXT        UNIQUE,
        guest_id         TEXT,
        chat_id          BIGINT,
        property_id      TEXT,
        guest_name       TEXT,
        phone            TEXT,
        email            TEXT,
        check_in         DATE,
        check_out        DATE,
        status           TEXT        NOT NULL DEFAULT 'confirmed',
        created_at       TIMESTAMPTZ NOT NULL DEFAULT NOW(),
        updated_at       TIMESTAMPTZ NOT NULL DEFAULT NOW()
      );
      CREATE INDEX IF NOT EXISTS idx_tg_guest_reservations_guest_id
        ON tg_guest_reservations (guest_id);
      CREATE INDEX IF NOT EXISTS idx_tg_guest_reservations_chat_id
        ON tg_guest_reservations (chat_id);
      CREATE INDEX IF NOT EXISTS idx_tg_guest_reservations_phone
        ON tg_guest_reservations (phone);
    `,
  },
  {
    label: '20260326a / tg_property_knowledge',
    sql: `
      CREATE TABLE IF NOT EXISTS tg_property_knowledge (
        property_id             TEXT        PRIMARY KEY,
        object_name             TEXT,
        check_in_instructions   TEXT,
        check_out_instructions  TEXT,
        wifi_instructions       TEXT,
        house_rules             TEXT,
        property_policy         TEXT,
        emergency_contacts      TEXT,
        upsells                 TEXT,
        parking_instructions    TEXT,
        payment_rules           TEXT,
        updated_at              TIMESTAMPTZ NOT NULL DEFAULT NOW()
      );
    `,
  },
  {
    label: '20260326a / tg_timeline_events',
    sql: `
      CREATE TABLE IF NOT EXISTS tg_timeline_events (
        id          UUID        PRIMARY KEY DEFAULT gen_random_uuid(),
        chat_id     BIGINT,
        guest_id    TEXT,
        event_type  TEXT        NOT NULL,
        event_data  JSONB,
        created_at  TIMESTAMPTZ NOT NULL DEFAULT NOW()
      );
      CREATE INDEX IF NOT EXISTS idx_tg_timeline_events_chat_created
        ON tg_timeline_events (chat_id, created_at DESC);
      CREATE INDEX IF NOT EXISTS idx_tg_timeline_events_guest_created
        ON tg_timeline_events (guest_id, created_at DESC);
    `,
  },
  {
    label: '20260326a / sessions.reservation_id column',
    sql: `
      ALTER TABLE tg_conversation_sessions
        ADD COLUMN IF NOT EXISTS reservation_id TEXT;
    `,
  },
  {
    label: '20260326a / seed prop_A property knowledge',
    sql: `
      INSERT INTO tg_property_knowledge (
        property_id, object_name,
        check_in_instructions, check_out_instructions,
        wifi_instructions, house_rules, property_policy,
        emergency_contacts, upsells
      ) VALUES (
        'prop_A',
        'Demo Apartment — Pilot Property',
        'Smart lock code is 1234*. Check-in is at 3:00 PM.',
        'Leave keys on table. Checkout at 11:00 AM.',
        'Network: GuestWifi, Pass: secret123',
        'No smoking, no pets. Parties are strictly forbidden.',
        'Strict quiet hours from 10 PM to 8 AM.',
        'Call maintenance at 555-0199 for plumbing/heating issues.',
        'Late checkout available for $50. Extra towels $10.'
      ) ON CONFLICT (property_id) DO NOTHING;
    `,
  },

  // ── 20260326000003 / tg_inquiry_flows ───────────────────────────────────
  {
    label: '20260326c / tg_inquiry_flows',
    sql: `
      CREATE TABLE IF NOT EXISTS tg_inquiry_flows (
        id                    UUID        PRIMARY KEY DEFAULT gen_random_uuid(),
        chat_id               BIGINT      NOT NULL UNIQUE,
        guest_id              TEXT,
        telegram_user_id      BIGINT,
        inquiry_status        TEXT        NOT NULL DEFAULT 'new_contact',
        booking_details       JSONB       NOT NULL DEFAULT '{}',
        intake_turn_count     INT         NOT NULL DEFAULT 0,
        handoff_type          TEXT,
        handoff_at            TIMESTAMPTZ,
        handoff_summary       TEXT,
        linked_reservation_id TEXT,
        converted_at          TIMESTAMPTZ,
        conversion_source     TEXT,
        last_inbound_at       TIMESTAMPTZ NOT NULL DEFAULT NOW(),
        last_outbound_at      TIMESTAMPTZ,
        created_at            TIMESTAMPTZ NOT NULL DEFAULT NOW(),
        updated_at            TIMESTAMPTZ NOT NULL DEFAULT NOW()
      );
      CREATE INDEX IF NOT EXISTS idx_tg_inquiry_flows_guest_id
        ON tg_inquiry_flows (guest_id);
      CREATE INDEX IF NOT EXISTS idx_tg_inquiry_flows_inquiry_status
        ON tg_inquiry_flows (inquiry_status);
    `,
  },

  // ── 20260326000002 / tg_stay_flows ──────────────────────────────────────
  {
    label: '20260326b / tg_stay_flows',
    sql: `
      CREATE TABLE IF NOT EXISTS tg_stay_flows (
        id                     UUID        PRIMARY KEY DEFAULT gen_random_uuid(),
        reservation_id         TEXT        NOT NULL UNIQUE,
        chat_id                BIGINT,
        guest_id               TEXT,
        property_id            TEXT,
        flow_status            TEXT        NOT NULL DEFAULT 'reservation_linked',
        flow_status_updated_at TIMESTAMPTZ NOT NULL DEFAULT NOW(),
        checkin_date           DATE,
        checkout_date          DATE,
        pre_checkin_sent_at    TIMESTAMPTZ,
        checkout_sent_at       TIMESTAMPTZ,
        followup_sent_at       TIMESTAMPTZ,
        created_at             TIMESTAMPTZ NOT NULL DEFAULT NOW(),
        updated_at             TIMESTAMPTZ NOT NULL DEFAULT NOW()
      );
      CREATE INDEX IF NOT EXISTS idx_tg_stay_flows_checkin
        ON tg_stay_flows (flow_status, checkin_date);
      CREATE INDEX IF NOT EXISTS idx_tg_stay_flows_checkout
        ON tg_stay_flows (flow_status, checkout_date);
      CREATE INDEX IF NOT EXISTS idx_tg_stay_flows_chat_id
        ON tg_stay_flows (chat_id);
    `,
  },

  // ── 20260327000001 / inquiry_flows.conversion_source ────────────────────
  // Idempotent ADD COLUMN — safe to run even if column already exists.
  {
    label: '20260327a / tg_inquiry_flows.conversion_source',
    sql: `
      ALTER TABLE tg_inquiry_flows
        ADD COLUMN IF NOT EXISTS conversion_source TEXT;
    `,
  },

  // ── 20260327000002 / escalation resolution columns ───────────────────────
  {
    label: '20260327b / tg_escalation_events resolution columns',
    sql: `
      ALTER TABLE tg_escalation_events
        ADD COLUMN IF NOT EXISTS resolved_at        TIMESTAMPTZ,
        ADD COLUMN IF NOT EXISTS resolved_by        TEXT,
        ADD COLUMN IF NOT EXISTS resolution_action  TEXT,
        ADD COLUMN IF NOT EXISTS operator_note      TEXT;
      CREATE INDEX IF NOT EXISTS idx_tg_escalation_events_unresolved
        ON tg_escalation_events (chat_id, created_at DESC)
        WHERE resolved_at IS NULL;
    `,
  },
];

// ─── Runner ───────────────────────────────────────────────────────────────────

async function runQuery(sql: string, token: string): Promise<{ ok: boolean; error?: string }> {
  try {
    const res = await fetch(MGMT_API, {
      method: 'POST',
      headers: {
        'Authorization': `Bearer ${token}`,
        'Content-Type': 'application/json',
      },
      body: JSON.stringify({ query: sql.trim() }),
    });

    if (res.ok) return { ok: true };

    const body = await res.text();
    return { ok: false, error: `HTTP ${res.status}: ${body.slice(0, 300)}` };
  } catch (err) {
    return { ok: false, error: String(err) };
  }
}

// ─── Route ────────────────────────────────────────────────────────────────────

export async function GET(req: Request) {
  const token =
    req.headers.get('x-mgmt-token') ||
    process.env.SUPABASE_MANAGEMENT_TOKEN;

  if (!token) {
    return NextResponse.json(
      {
        error: 'Missing Supabase management token.',
        hint:  'Pass your Supabase PAT via the x-mgmt-token request header, or set SUPABASE_MANAGEMENT_TOKEN env var.',
        getToken: 'https://app.supabase.com/account/tokens',
      },
      { status: 401 },
    );
  }

  const results: { label: string; status: 'ok' | 'error'; error?: string }[] = [];
  let errors = 0;

  for (const { label, sql } of MIGRATIONS) {
    const { ok, error } = await runQuery(sql, token);
    results.push({ label, status: ok ? 'ok' : 'error', ...(error ? { error } : {}) });
    if (!ok) errors++;
  }

  return NextResponse.json(
    {
      ok:             errors === 0,
      totalSteps:     MIGRATIONS.length,
      stepsOk:        MIGRATIONS.length - errors,
      stepsErrored:   errors,
      results,
      nextStep:       errors === 0
        ? 'All migrations applied. You may now delete this route and call /api/admin/seed-test-data.'
        : 'Fix the errored steps above, then re-run. All steps are idempotent.',
    },
    { status: errors === 0 ? 200 : 207 },
  );
}
