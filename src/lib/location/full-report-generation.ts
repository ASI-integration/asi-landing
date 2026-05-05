import { geocodePlainAddressForMarket } from '@/lib/location/address-providers/geocode-pipeline';
import type { AddressMarket } from '@/lib/location/address-providers/types';
import { fetchOsmData, buildAnalysis } from '@/lib/location';
import { buildCommercialReport, buildLocationStandaloneReport } from '@/lib/location/standalone-report';
import { createStandaloneReport } from '@/lib/location/standalone-report-store';
import {
  attachLocationReportRequestReport,
  getLocationReportRequestById,
  markLocationReportRequestFailed,
  markLocationReportRequestProcessing,
  type LocationReportLocale,
  type LocationReportRequestEntity,
} from '@/lib/location/report-request-store';

function parseMarket(locale: LocationReportLocale): AddressMarket {
  return locale === 'ru' ? 'ru' : 'en';
}

export async function generateLocationStandaloneReportForRequest(
  entity: LocationReportRequestEntity,
): Promise<{ reportId: string }> {
  let lat = entity.lat;
  let lon = entity.lon;

  if (lat == null || lon == null) {
    const { result } = await geocodePlainAddressForMarket(parseMarket(entity.locale), entity.address);
    if (!result) throw new Error('address_not_found');
    lat = result.lat;
    lon = result.lon;
  }

  const { elements } = await fetchOsmData(lat, lon);
  const analysis = buildAnalysis(elements, lat, lon, { spatialFoundation: true });

  const report =
    entity.mode === 'commercial'
      ? buildCommercialReport({ address: entity.address, analysis })
      : buildLocationStandaloneReport({
        address: entity.address,
        analysis,
        market: entity.locale === 'ru' ? 'RU' : 'INTERNATIONAL',
      });

  return createStandaloneReport({ locale: entity.locale, report: report as any });
}

export async function generateAndAttachLocationReportForRequest(
  requestId: string,
): Promise<{ reportId: string }> {
  const entity = await getLocationReportRequestById(requestId);
  if (!entity) throw new Error('not_found');
  if (entity.status === 'completed' && entity.report_id) return { reportId: entity.report_id };
  if (entity.status === 'processing') throw new Error('already_processing');

  await markLocationReportRequestProcessing(requestId);

  try {
    const { reportId } = await generateLocationStandaloneReportForRequest(entity);
    await attachLocationReportRequestReport({ requestId, reportId });
    return { reportId };
  } catch (err) {
    const msg = err instanceof Error ? err.message : String(err);
    await markLocationReportRequestFailed({ requestId, errorMessage: msg });
    throw err;
  }
}
