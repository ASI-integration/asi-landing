/**
 * RU location demo: cartographic fetch warnings shared by API meta and scoring policy.
 * Keep in `src/lib/location` so kernel/contracts do not import UI modules.
 */

export const PARTIAL_CARTOGRAPHIC_WARNING_CODES: ReadonlySet<string> = new Set([
  'partial_result',
  'overpass_timeout',
  'geocode_timeout',
  'insufficient_data',
]);

export function metaWarningsIndicatePartialCartography(
  warnings: readonly { code: string }[] | undefined | null,
): boolean {
  if (!warnings?.length) return false;
  return warnings.some(w => PARTIAL_CARTOGRAPHIC_WARNING_CODES.has(w.code));
}
