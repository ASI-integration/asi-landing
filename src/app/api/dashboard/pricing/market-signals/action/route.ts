import { NextResponse } from 'next/server';
import { requireOpsAdminSession } from '@/lib/crm/api-auth';
import {
  addMarketSignalNote,
  blockMarketSignalSource,
  computeMarketPressureScore,
  configureMarketSignalSource,
  importChannelPricingSignals,
  ingestCompetitorSnapshot,
  ingestEventsSnapshot,
  ingestManualMarketSnapshot,
  ingestSupplySnapshot,
  ingestWeatherSnapshot,
  initializeMarketSignalSource,
  runMarketSignalIngestion,
  type MarketSourceProvider,
  type MarketSourceType,
} from '@/lib/booking-ops/market-signals-ingestion';

export const runtime = 'nodejs';
export const dynamic = 'force-dynamic';

const ACTIONS = new Set([
  'initialize_source', 'configure_source', 'ingest_manual_snapshot', 'ingest_competitor_snapshot',
  'ingest_supply_snapshot', 'ingest_events_snapshot', 'ingest_weather_snapshot',
  'import_channel_pricing_signals', 'run_ingestion', 'compute_market_pressure', 'block_source', 'add_note',
]);

export async function POST(req: Request): Promise<NextResponse> {
  const auth = await requireOpsAdminSession();
  if ('error' in auth) return auth.error;
  let body: Record<string, unknown>;
  try { body = await req.json() as Record<string, unknown>; }
  catch { return NextResponse.json({ ok: false, message: 'Некорректный JSON.' }, { status: 400 }); }
  const action = String(body.action ?? '').trim();
  if (!ACTIONS.has(action)) return NextResponse.json({ ok: false, message: 'Недопустимое действие.' }, { status: 400 });
  const propertySetupId = typeof body.propertySetupId === 'string' ? body.propertySetupId : '';
  const sourceId = typeof body.sourceId === 'string' ? body.sourceId : '';
  const metadata = body.metadata && typeof body.metadata === 'object' ? body.metadata as Record<string, unknown> : undefined;
  try {
    let result: unknown;
    switch (action) {
      case 'initialize_source': result = await initializeMarketSignalSource(propertySetupId, String(body.sourceType ?? 'manual') as MarketSourceType, String(body.provider ?? 'manual') as MarketSourceProvider, metadata); break;
      case 'configure_source': result = await configureMarketSignalSource(sourceId, body.config && typeof body.config === 'object' ? body.config as Record<string, unknown> : {}, metadata); break;
      case 'ingest_manual_snapshot': result = await ingestManualMarketSnapshot(propertySetupId, body.snapshot, metadata); break;
      case 'ingest_competitor_snapshot': result = await ingestCompetitorSnapshot(propertySetupId, (body.snapshot ?? {}) as Record<string, unknown>, metadata); break;
      case 'ingest_supply_snapshot': result = await ingestSupplySnapshot(propertySetupId, (body.snapshot ?? {}) as Record<string, unknown>, metadata); break;
      case 'ingest_events_snapshot': result = await ingestEventsSnapshot(propertySetupId, Array.isArray(body.events) ? body.events : [], { ...metadata, date: body.date, radius_km: body.radius_km }); break;
      case 'ingest_weather_snapshot': result = await ingestWeatherSnapshot(propertySetupId, Array.isArray(body.weatherRows) ? body.weatherRows : [body.weather], { ...metadata, radius_km: body.radius_km }); break;
      case 'import_channel_pricing_signals': result = await importChannelPricingSignals(propertySetupId, typeof body.connectionId === 'string' ? body.connectionId : undefined, metadata); break;
      case 'run_ingestion': result = await runMarketSignalIngestion(sourceId, { dryRun: Boolean(body.dryRun), metadata }); break;
      case 'compute_market_pressure': result = await computeMarketPressureScore(propertySetupId, typeof body.date === 'string' ? body.date : new Date().toISOString().slice(0, 10)); break;
      case 'block_source': result = await blockMarketSignalSource(sourceId, typeof body.reason === 'string' ? body.reason : 'Заблокировано оператором.', metadata); break;
      case 'add_note': result = await addMarketSignalNote(sourceId, typeof body.note === 'string' ? body.note : '', metadata); break;
    }
    return NextResponse.json({ ok: true, result, externalProvidersCalled: false, otaPricePush: false });
  } catch (error) {
    return NextResponse.json({ ok: false, message: error instanceof Error ? error.message : 'Действие не выполнено.' }, { status: 400 });
  }
}
