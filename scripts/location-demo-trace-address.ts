/**
 * One-shot trace dump for a single address (geocode → OSM → buildAnalysis),
 * mirroring /api/location-demo-analyze (non-spatial, no cache).
 *
 * Usage:
 *   npx tsx scripts/location-demo-trace-address.ts
 *
 * Optional env:
 *   DEMO_TRACE_ADDRESS="проспект ..., город"
 */
import { geocodePlainAddressForMarket } from '../src/lib/location/address-providers/geocode-pipeline';
import { fetchOsmData } from '../src/lib/location/overpass';
import { buildAnalysis } from '../src/lib/location/gravity-scoring';
import { enrichAnalysisWithReportProjection } from '../src/lib/location/location-scoring-projection';
import {
  cloneAnalysisForResidentialDemoPatch,
  applyResidentialDemoPresentationToAnalysis,
} from '../src/lib/location/residential-demo-presentation';
import { buildLocationScoreCustodySnapshot } from '../src/lib/location/location-score-chain-of-custody';

const ADDRESS =
  process.env.DEMO_TRACE_ADDRESS?.trim() ||
  'проспект Пархоменко, 15, Санкт-Петербург';

async function main() {
  const geo = await geocodePlainAddressForMarket('ru', ADDRESS);
  const displayName = geo.result?.displayName ?? null;
  const lat = geo.result?.lat;
  const lon = geo.result?.lon;

  if (lat == null || lon == null || !Number.isFinite(lat) || !Number.isFinite(lon)) {
    // eslint-disable-next-line no-console
    console.error(JSON.stringify({ error: 'geocode_failed', ADDRESS, geoWinner: geo.winner }, null, 2));
    process.exit(1);
  }

  const { elements, usedFallbackQuery, hadProviderFailure } = await fetchOsmData(lat, lon);
  const analysis = buildAnalysis(elements, lat, lon, {
    spatialFoundation: false,
    inputAddress: ADDRESS,
  });

  const projected = enrichAnalysisWithReportProjection(analysis, { reportMode: 'free' });
  const trace = projected.scoringTrace!;

  const ruDemoClone = cloneAnalysisForResidentialDemoPatch(analysis);
  const demoSanityMeta = applyResidentialDemoPresentationToAnalysis(ruDemoClone);

  const slice = {
    note:
      'Public /100 headline is scoringTrace.finalScore. RU residential demo guards are caps on the trace (see capsApplied ru_residential_demo_presentation). evergreenIndex stays an internal scoreFeatures input.',
    geocode: {
      winner: geo.winner,
      selectedGeocodeResult: displayName,
      coordinates: { lat, lon },
    },
    pipeline: {
      usedFallbackQuery: Boolean(usedFallbackQuery),
      hadProviderFailure: Boolean(hadProviderFailure),
    },
    custodyEngine: buildLocationScoreCustodySnapshot(analysis),
    custodyRuDemoResponseLike: buildLocationScoreCustodySnapshot(ruDemoClone),
    demoSanityMeta,
    scoringTraceProjectedFreeMode: {
      inputAddress: trace.inputAddress,
      coordinates: trace.coordinates,
      selectedGeocodeResult: trace.selectedGeocodeResult,
      rawObjectsCount: trace.rawObjectsCount,
      classifiedMagnets: trace.classifiedMagnets,
      scoreFeatures: trace.scoreFeatures,
      baseScore: trace.baseScore,
      capsApplied: trace.capsApplied,
      finalScore: trace.finalScore,
      evidence: trace.evidence,
      publicBullets: trace.publicBullets,
      warnings: trace.warnings,
    },
  };

  // eslint-disable-next-line no-console
  console.log(JSON.stringify(slice, null, 2));
}

main().catch((e) => {
  // eslint-disable-next-line no-console
  console.error(e);
  process.exit(1);
});
