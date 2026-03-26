/**
 * Admin recovery endpoint: create missing tg_stay_flows rows for inquiries
 * that were already converted_to_reservation before stay-flow init was added.
 *
 * HOW TO USE:
 *   POST /api/admin/recover-stay-flows
 *   Header: x-admin-secret: {ADMIN_SECRET env var}
 *   Body (JSON, optional):
 *     { "chat_id": 1343269271 }   // scope to a single chat for targeted recovery
 *                                 // omit to recover ALL affected chats
 *
 * Returns:
 *   200 { ok: true, recovered, skipped, errors, details[], message }
 *   401 { error: "Unauthorized" }
 *   500 { ok: false, error: "..." }
 *
 * Idempotent: safe to call multiple times — rows that already have a stay_flow
 * are skipped and counted in `skipped`.
 *
 * Auth: x-admin-secret header must match ADMIN_SECRET env var (if set).
 */

import { NextResponse } from 'next/server';
import { recoverMissingStayFlows } from '@/lib/communication/reservation-bridge';

const ADMIN_SECRET = process.env.ADMIN_SECRET;

export async function POST(req: Request) {
  // ── Auth ──────────────────────────────────────────────────────────────────
  const secret = req.headers.get('x-admin-secret');
  if (ADMIN_SECRET && secret !== ADMIN_SECRET) {
    return NextResponse.json({ error: 'Unauthorized' }, { status: 401 });
  }

  // ── Parse optional body ───────────────────────────────────────────────────
  let chatId: number | undefined;
  try {
    const body = await req.json();
    if (body?.chat_id != null) chatId = Number(body.chat_id);
  } catch {
    // Body is optional — no chat_id means recover all affected chats.
  }

  // ── Run recovery ──────────────────────────────────────────────────────────
  const result = await recoverMissingStayFlows({ chatId });

  if (!result.ok) {
    return NextResponse.json(result, { status: 500 });
  }

  return NextResponse.json({
    ...result,
    message: chatId != null
      ? `Scoped to chatId=${chatId}: recovered=${result.recovered}, skipped=${result.skipped}, errors=${result.errors}`
      : `Global recovery: recovered=${result.recovered}, skipped=${result.skipped}, errors=${result.errors}`,
  });
}
