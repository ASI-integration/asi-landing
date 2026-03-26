/**
 * Operator bridge action: link a booking inquiry to a confirmed reservation.
 *
 * After receiving a booking inquiry handoff notification, the operator uses
 * their real-world booking data to confirm the reservation. This endpoint
 * records the linkage, initialises the stay-flow, and marks the inquiry as
 * converted — removing the manual gap between inquiry handoff and automated
 * stay management.
 *
 * HOW TO USE:
 *   POST /api/admin/link-reservation
 *   Header: x-admin-secret: {ADMIN_SECRET env var}
 *   Body (JSON):
 *     {
 *       "chat_id":         <number>   // Telegram chat ID — from handoff notification
 *                                     // OR use "inquiry_flow_id" instead
 *       "inquiry_flow_id": <string>   // UUID from tg_inquiry_flows.id (alternative)
 *       "reservation_ref": <string>   // REQUIRED — your booking reference
 *       "property_id":     <string>   // optional, e.g. "prop_A"
 *       "guest_name":      <string>   // optional — for stay-flow messages
 *       "check_in":        <string>   // optional — YYYY-MM-DD
 *       "check_out":       <string>   // optional — YYYY-MM-DD
 *       "operator_note":   <string>   // optional — recorded in timeline
 *     }
 *
 * Returns:
 *   200 { ok: true, reservationId, stayFlowId, inquiryFlowId, nextStep }
 *   200 { ok: true, alreadyConverted: true, ... }   ← harmless retry
 *   400 { error: "..." }                             ← missing required fields
 *   401 { error: "Unauthorized" }
 *   404 { error: "inquiry_not_found" }
 *   500 { error: "..." }
 *
 * Idempotent: safe to call multiple times — no duplicate rows are created.
 *
 * Auth: x-admin-secret header must match ADMIN_SECRET env var (if set).
 */

import { NextResponse } from 'next/server';
import { operatorLinkReservation } from '@/lib/communication/reservation-bridge';

const ADMIN_SECRET = process.env.ADMIN_SECRET;

export async function POST(req: Request) {
  // ── Auth ──────────────────────────────────────────────────────────────────
  const secret = req.headers.get('x-admin-secret');
  if (ADMIN_SECRET && secret !== ADMIN_SECRET) {
    return NextResponse.json({ error: 'Unauthorized' }, { status: 401 });
  }

  // ── Parse body ────────────────────────────────────────────────────────────
  let body: Record<string, unknown>;
  try {
    body = await req.json();
  } catch {
    return NextResponse.json({ error: 'Invalid JSON body' }, { status: 400 });
  }

  const {
    inquiry_flow_id,
    chat_id,
    reservation_ref,
    property_id,
    guest_name,
    check_in,
    check_out,
    operator_note,
  } = body as {
    inquiry_flow_id?: string;
    chat_id?:         number | string;
    reservation_ref?: string;
    property_id?:     string;
    guest_name?:      string;
    check_in?:        string;
    check_out?:       string;
    operator_note?:   string;
  };

  // ── Validate ──────────────────────────────────────────────────────────────
  if (!reservation_ref) {
    return NextResponse.json({ error: 'reservation_ref is required' }, { status: 400 });
  }
  if (!inquiry_flow_id && chat_id == null) {
    return NextResponse.json(
      { error: 'Either inquiry_flow_id or chat_id is required' },
      { status: 400 },
    );
  }

  // ── Execute bridge ────────────────────────────────────────────────────────
  const result = await operatorLinkReservation({
    inquiryFlowId: inquiry_flow_id,
    chatId:        chat_id != null ? Number(chat_id) : undefined,
    reservationRef: reservation_ref,
    propertyId:    property_id,
    guestName:     guest_name,
    checkIn:       check_in,
    checkOut:      check_out,
    operatorNote:  operator_note,
  });

  if (!result.ok) {
    const status = result.error === 'inquiry_not_found' ? 404 : 500;
    return NextResponse.json(result, { status });
  }

  return NextResponse.json({
    ...result,
    nextStep: result.alreadyConverted
      ? 'Inquiry was already converted — no changes made.'
      : 'Reservation linked, inquiry converted_to_reservation, stay-flow initialized in reservation_linked state.',
  });
}
