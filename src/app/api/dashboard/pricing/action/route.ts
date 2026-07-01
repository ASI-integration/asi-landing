import { NextResponse } from 'next/server';
import { requireOpsAdminSession } from '@/lib/crm/api-auth';
import {
  blockPricing,
  addPricingNote,
  generateTariffGrid,
  initializePricingProfile,
  ingestMarketSignals,
  inferPropertyAudience,
  markPricingAutoApplyEnabledPlaceholder,
  markPricingAutoApplyReady,
  markPricingRecommendationsReady,
  runPricingRecommendation,
  updatePricingGuardrails,
} from '@/lib/booking-ops/pricing-intelligence-autopilot';
import { updatePropertyAudienceProfile, type PrimaryAudience } from '@/lib/booking-ops/property-audience-intelligence';

export const runtime = 'nodejs';
export const dynamic = 'force-dynamic';

const ACTIONS = new Set([
  'initialize_profile',
  'infer_audience',
  'update_audience',
  'update_guardrails',
  'ingest_market_snapshot',
  'generate_tariff_grid',
  'run_recommendation',
  'mark_recommendations_ready',
  'mark_auto_apply_ready',
  'mark_auto_apply_enabled_placeholder',
  'block_pricing',
  'add_note',
]);

export async function POST(req: Request): Promise<NextResponse> {
  const auth = await requireOpsAdminSession();
  if ('error' in auth) return auth.error;

  let body: Record<string, unknown>;
  try {
    body = (await req.json()) as Record<string, unknown>;
  } catch {
    return NextResponse.json({ ok: false, message: 'Некорректный JSON.' }, { status: 400 });
  }

  const action = String(body.action ?? '').trim();
  if (!ACTIONS.has(action)) {
    return NextResponse.json({ ok: false, message: 'Недопустимое действие.' }, { status: 400 });
  }

  const propertySetupId = typeof body.propertySetupId === 'string' ? body.propertySetupId : undefined;
  const pricingProfileId = typeof body.pricingProfileId === 'string' ? body.pricingProfileId : undefined;
  const metadata = body.metadata && typeof body.metadata === 'object'
    ? body.metadata as Record<string, unknown>
    : undefined;

  try {
    switch (action) {
      case 'initialize_profile': {
        if (!propertySetupId) throw new Error('Укажите propertySetupId.');
        const profile = await initializePricingProfile(propertySetupId, metadata);
        return NextResponse.json({ ok: true, profile, autoApplyIsPlaceholder: true });
      }
      case 'infer_audience': {
        if (!propertySetupId) throw new Error('Укажите propertySetupId.');
        const audience = await inferPropertyAudience(propertySetupId, metadata);
        return NextResponse.json({ ok: true, audience });
      }
      case 'update_audience': {
        if (!propertySetupId) throw new Error('Укажите propertySetupId.');
        const payload = body.audience && typeof body.audience === 'object' ? body.audience as Record<string, unknown> : {};
        const audience = await updatePropertyAudienceProfile(propertySetupId, {
          primaryAudience: String(payload.primaryAudience ?? 'unknown') as PrimaryAudience,
          secondaryAudiences: Array.isArray(payload.secondaryAudiences) ? payload.secondaryAudiences as PrimaryAudience[] : [],
          confidenceScore: Number(payload.confidenceScore ?? 50),
          explanation: typeof payload.explanation === 'string' ? payload.explanation : undefined,
        }, metadata);
        return NextResponse.json({ ok: true, audience });
      }
      case 'update_guardrails': {
        if (!pricingProfileId) throw new Error('Укажите pricingProfileId.');
        const guardrails = body.guardrails && typeof body.guardrails === 'object' ? body.guardrails as Record<string, unknown> : {};
        const profile = await updatePricingGuardrails(pricingProfileId, guardrails, metadata);
        return NextResponse.json({ ok: true, profile });
      }
      case 'ingest_market_snapshot': {
        if (!propertySetupId) throw new Error('Укажите propertySetupId.');
        const snapshot = body.snapshot ?? body.signals;
        const signals = await ingestMarketSignals(propertySetupId, snapshot as never, metadata);
        return NextResponse.json({ ok: true, signals });
      }
      case 'generate_tariff_grid': {
        if (!pricingProfileId) throw new Error('Укажите pricingProfileId.');
        const days = Number(body.days ?? 30);
        const dateFrom = typeof body.dateFrom === 'string' ? body.dateFrom : new Date().toISOString().slice(0, 10);
        const end = new Date(dateFrom);
        end.setDate(end.getDate() + days - 1);
        const grid = await generateTariffGrid(pricingProfileId, dateFrom, end.toISOString().slice(0, 10));
        return NextResponse.json({ ok: true, days: grid, autoApplyIsPlaceholder: true });
      }
      case 'run_recommendation': {
        if (!pricingProfileId) throw new Error('Укажите pricingProfileId.');
        const dateFrom = typeof body.dateFrom === 'string' ? body.dateFrom : new Date().toISOString().slice(0, 10);
        const dayCount = Number(body.days ?? 30);
        const end = new Date(dateFrom);
        end.setDate(end.getDate() + dayCount - 1);
        const run = await runPricingRecommendation(pricingProfileId, dateFrom, end.toISOString().slice(0, 10), { dryRun: Boolean(body.dryRun) });
        return NextResponse.json({ ok: true, run, autoApplyIsPlaceholder: true });
      }
      case 'mark_recommendations_ready': {
        if (!pricingProfileId) throw new Error('Укажите pricingProfileId.');
        const profile = await markPricingRecommendationsReady(pricingProfileId, metadata);
        return NextResponse.json({ ok: true, profile });
      }
      case 'mark_auto_apply_ready': {
        if (!pricingProfileId) throw new Error('Укажите pricingProfileId.');
        const profile = await markPricingAutoApplyReady(pricingProfileId, metadata);
        return NextResponse.json({ ok: true, profile, autoApplyIsPlaceholder: true });
      }
      case 'mark_auto_apply_enabled_placeholder': {
        if (!pricingProfileId) throw new Error('Укажите pricingProfileId.');
        const profile = await markPricingAutoApplyEnabledPlaceholder(pricingProfileId, metadata);
        return NextResponse.json({ ok: true, profile, autoApplyIsPlaceholder: true, honestNotice: 'Пилотное авто-применение — не live-пуш цен в OTA.' });
      }
      case 'block_pricing': {
        if (!pricingProfileId) throw new Error('Укажите pricingProfileId.');
        const reason = typeof body.reason === 'string' ? body.reason : 'Заблокировано оператором';
        const profile = await blockPricing(pricingProfileId, reason, metadata);
        return NextResponse.json({ ok: true, profile });
      }
      case 'add_note': {
        if (!pricingProfileId) throw new Error('Укажите pricingProfileId.');
        const note = typeof body.note === 'string' ? body.note : '';
        if (!note.trim()) throw new Error('Укажите текст заметки.');
        const profile = await addPricingNote(pricingProfileId, note, metadata);
        return NextResponse.json({ ok: true, profile });
      }
      default:
        return NextResponse.json({ ok: false, message: 'Действие не поддерживается.' }, { status: 400 });
    }
  } catch (error) {
    const message = error instanceof Error ? error.message : 'Не удалось выполнить действие.';
    return NextResponse.json({ ok: false, message }, { status: 400 });
  }
}
