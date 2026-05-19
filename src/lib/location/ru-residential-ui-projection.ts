/**
 * RU residential free/demo UI copy — derives display strings only from
 * {@link LocationDecision} (kernel output). Does not affect scoring.
 */

import type { LocationDecision, LocationEvidenceItem } from './location-decision-contract';
import { formatDistanceRu } from './location-decision-rules';
import { isCityLevelStrategicAnchor } from './location-evidence-anchor';

export const RU_RESIDENTIAL_NEUTRAL_EVIDENCE_LINE_RU =
  'Подтверждённых сильных магнитов в кратком отчёте не найдено.';

function usableEvidenceItems(items: readonly LocationEvidenceItem[]): LocationEvidenceItem[] {
  return items.filter(e => {
    if (!e.objectName.trim().length || !e.typeRu.trim().length) return false;
    if (isCityLevelStrategicAnchor(e)) return true;
    return Number.isFinite(e.distanceMeters) && (e.distanceMeters ?? 0) > 0;
  });
}

/** One public line: object name · category/type · distance (evidence-backed). */
export function formatRuResidentialEvidenceRowRu(item: LocationEvidenceItem): string {
  if (isCityLevelStrategicAnchor(item)) {
    return item.publicExplanationRu.trim() || item.objectName;
  }
  const cat = item.subtypeRu ? `${item.typeRu} (${item.subtypeRu})` : item.typeRu;
  if (item.distanceMeters == null || !Number.isFinite(item.distanceMeters)) {
    return `${item.objectName} — ${cat}`;
  }
  const dist = formatDistanceRu(item.distanceMeters);
  return `${item.objectName} — ${cat}, ${dist}`;
}

/**
 * Demand headline for the middle KPI tile — «туристический» only when kernel DemandSignals
 * include tourist role backed by evidenceFactIds.
 */
export function resolveRuResidentialDemandHeadlineRu(decision: LocationDecision | null): string {
  if (!decision) return 'Смешанный профиль спроса';
  const sigs = decision.demandSignals.filter(s => s.evidenceFactIds.length > 0);
  if (sigs.some(s => s.type.startsWith('tourist_demand_'))) {
    return 'Туристический спрос в зоне';
  }
  if (sigs.some(s => s.type.startsWith('business_demand_'))) {
    return 'Спрос от делового и офисного трафика';
  }
  if (sigs.some(s => s.type.startsWith('transport_anchor_'))) {
    return 'Транзитный и транспортно-связанный спрос';
  }
  if (sigs.some(s => s.type.startsWith('accessibility_'))) {
    return 'Транзитный и транспортно-связанный спрос';
  }
  if (sigs.some(s => s.type.startsWith('event_demand_'))) {
    return 'Событийный и досуговой спрос в зоне';
  }
  if (sigs.some(s => s.type.startsWith('medical_demand_'))) {
    return 'Спрос с медицинским профилем в зоне';
  }
  return 'Смешанный профиль спроса';
}

export function ruResidentialDemandSignalsIncludeTouristEvidence(decision: LocationDecision | null): boolean {
  if (!decision) return false;
  return decision.demandSignals.some(
    s => s.evidenceFactIds.length > 0 && s.type.startsWith('tourist_demand_'),
  );
}

/** Canonical bullet strings for RU residential demo (from kernel evidence only). */
export function buildRuResidentialPublicEvidenceLines(
  decision: LocationDecision | null,
  max = 5,
): string[] {
  if (!decision) return [RU_RESIDENTIAL_NEUTRAL_EVIDENCE_LINE_RU];
  const usable = usableEvidenceItems(decision.evidenceItems);
  if (usable.length === 0) return [RU_RESIDENTIAL_NEUTRAL_EVIDENCE_LINE_RU];
  return usable.slice(0, max).map(formatRuResidentialEvidenceRowRu);
}
