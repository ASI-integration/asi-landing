import { NextRequest, NextResponse } from 'next/server';
import { geocodePlainAddressForMarket } from '@/lib/location/address-providers/geocode-pipeline';
import type { AddressMarket } from '@/lib/location/address-providers/types';
import { fetchOsmData, buildAnalysis } from '@/lib/location';
import { buildLocationStandaloneReport, buildCommercialReport } from '@/lib/location/standalone-report';
import { createStandaloneReport } from '@/lib/location/standalone-report-store';
import {
  getLocationReportRequestById,
  markLocationReportRequestCompleted,
  markLocationReportRequestFailed,
  markLocationReportRequestProcessing,
} from '@/lib/location/report-request-store';

export const dynamic = 'force-dynamic';
export const maxDuration = 60;

function hasManualConfirmation(req: NextRequest): boolean {
  const configured = process.env.LOCATION_REPORT_MANUAL_CONFIRM_KEY?.trim();
  if (!configured) return false;
  const supplied = req.headers.get('x-location-report-confirmation')?.trim();
  return supplied === configured;
}

function parseMarket(locale: 'ru' | 'en'): AddressMarket {
  return locale === 'ru' ? 'ru' : 'en';
}

export async function POST(req: NextRequest) {
  let body: any;
  try {
    body = await req.json();
  } catch {
    return NextResponse.json({ error: 'invalid JSON' }, { status: 400 });
  }

  const requestId = typeof body?.requestId === 'string' ? body.requestId.trim() : '';
  if (!requestId) return NextResponse.json({ error: 'requestId required' }, { status: 400 });

  const entity = await getLocationReportRequestById(requestId);
  if (!entity) return NextResponse.json({ error: 'not_found' }, { status: 404 });

  if (entity.access_tier === 'paid_required' && !hasManualConfirmation(req)) {
    return NextResponse.json(
      {
        status: entity.status,
        error: 'manual_confirmation_required',
        note: entity.locale === 'ru'
          ? 'Полный отчёт формируется после оплаты или ручного подтверждения заказа.'
          : 'The full report is generated after payment or manual order confirmation.',
      },
      { status: 403 },
    );
  }

  // Idempotency: if already done, return the result.
  if (entity.status === 'completed' && entity.report_id) {
    return NextResponse.json({ status: 'completed', reportId: entity.report_id });
  }
  if (entity.status === 'processing') {
    return NextResponse.json({ status: 'processing' }, { status: 202 });
  }

  await markLocationReportRequestProcessing(requestId);

  try {
    const locale = entity.locale;
    const market = parseMarket(locale);
    let lat = entity.lat;
    let lon = entity.lon;

    if (lat == null || lon == null) {
      const { result } = await geocodePlainAddressForMarket(market, entity.address);
      if (!result) {
        await markLocationReportRequestFailed({ requestId, errorMessage: 'address_not_found' });
        return NextResponse.json({ status: 'failed', error: 'address_not_found' }, { status: 404 });
      }
      lat = result.lat;
      lon = result.lon;
    }

    // Full calculation (may be slow for dense cities).
    // We deliberately enable spatial foundation here: preview stays fast, report can be deeper.
    const { elements } = await fetchOsmData(lat, lon);
    const analysis = buildAnalysis(elements, lat, lon, { spatialFoundation: true });

    const report =
      entity.mode === 'commercial'
        ? buildCommercialReport({ address: entity.address, analysis })
        : buildLocationStandaloneReport({
          address: entity.address,
          analysis,
          verdict: locale === 'ru'
            ? 'Полный отчёт: расчёт выполнен.'
            : 'Full report: calculation completed.',
          market: locale === 'ru' ? 'RU' : 'INTERNATIONAL',
          reportMode: 'paid',
        });

    const { reportId } = await createStandaloneReport({ locale, report: report as any });
    await markLocationReportRequestCompleted({ requestId, reportId });

    return NextResponse.json({ status: 'completed', reportId });
  } catch (err) {
    const msg = err instanceof Error ? err.message : String(err);
    await markLocationReportRequestFailed({ requestId, errorMessage: msg });
    return NextResponse.json({ status: 'failed', error: msg }, { status: 502 });
  }
}

