import { haversineMeters } from './geometry';

/** Offline observation-shape gate, not authentication of external evidence.
 * Caller verification assertions must be independently audited against pinned artifacts.
 * A coordinate match is not walking access or demand proof. */
export interface GeographicObservation {
  subject: { lat: number; lon: number; identityVerified: boolean };
  poi: { lat: number; lon: number; osmType: 'node' | 'way' | 'relation'; osmId: number };
  sourceUrl: string;
  retrievedAt: string;
  providerStatus: 'ok' | 'unavailable';
  barrier: 'none-verified' | 'present' | 'unknown';
  walkingRoute?: { metres: number; sourceUrl: string; verified: boolean };
  monthlyDemandVerified: boolean;
  propertyUseVerified: boolean;
}
const coordinatesValid = (p: {lat:number;lon:number}) => Number.isFinite(p.lat) && Number.isFinite(p.lon) && Math.abs(p.lat) <= 90 && Math.abs(p.lon) <= 180;
const webUrl = (s: string) => { try { return ['https:', 'http:'].includes(new URL(s).protocol); } catch { return false; } };
export function evaluateGeographicEvidence(input: unknown, now: Date, maxAgeDays = 30) {
  const reasons: string[] = [];
  const invalid = { status: 'HOLD' as const, reasons: ['INVALID_OBSERVATION'], straightLineMetres: null, walkingMetres: null, profitabilityVerified: false as const, externallyVerified: false as const };
  if (!input || typeof input !== 'object') return invalid;
  const o = input as GeographicObservation;
  if (!o.subject || typeof o.subject !== 'object' || !o.poi || typeof o.poi !== 'object') return invalid;
  const timestamp = Date.parse(o.retrievedAt);
  const age = now.getTime() - timestamp;
  if (!Number.isFinite(now.getTime()) || !Number.isFinite(maxAgeDays) || maxAgeDays < 0 || !Number.isFinite(age) || age < 0 || age > maxAgeDays * 86400000) reasons.push('STALE_OR_INVALID_DATE');
  if (o.providerStatus !== 'ok') reasons.push('PROVIDER_UNAVAILABLE');
  if (!webUrl(o.sourceUrl) || !Number.isSafeInteger(o.poi.osmId) || o.poi.osmId <= 0 || !['node','way','relation'].includes(o.poi.osmType)) reasons.push('INVALID_PROVENANCE');
  if (o.subject.identityVerified !== true) reasons.push('SUBJECT_IDENTITY_UNVERIFIED');
  const valid = coordinatesValid(o.subject) && coordinatesValid(o.poi);
  if (!valid) reasons.push('INVALID_COORDINATES');
  const straightLineMetres = valid ? haversineMeters(o.subject.lat,o.subject.lon,o.poi.lat,o.poi.lon) : null;
  const route = o.walkingRoute;
  const walkingVerified = !!route && route.verified === true && webUrl(route.sourceUrl) && Number.isFinite(route.metres) && straightLineMetres !== null && route.metres >= straightLineMetres;
  if (!walkingVerified) reasons.push(o.barrier === 'present' ? 'BARRIER_ROUTE_UNVERIFIED' : 'WALKING_ROUTE_UNVERIFIED');
  if (o.monthlyDemandVerified !== true) reasons.push('SEASONALITY_UNVERIFIED');
  if (o.propertyUseVerified !== true) reasons.push('PROPERTY_USE_UNVERIFIED');
  return { status: reasons.length ? 'HOLD' as const : 'OBSERVATION_FIELDS_COMPLETE' as const, reasons, straightLineMetres, walkingMetres: walkingVerified ? route!.metres : null, profitabilityVerified: false as const, externallyVerified: false as const };
}
