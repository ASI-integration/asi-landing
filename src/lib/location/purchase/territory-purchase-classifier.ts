import type {
  PurchaseTerritoryClassification,
  PurchaseTerritoryEvidence,
  PurchaseTrajectoryConfidence,
} from './types';

function score(value: number | undefined): number {
  if (!Number.isFinite(value)) return 0;
  return Math.max(0, Math.min(100, Math.round(value as number)));
}

function ratioToScore(value: number | undefined): number {
  if (!Number.isFinite(value)) return 0;
  const n = value as number;
  return n <= 1 ? Math.round(Math.max(0, Math.min(1, n)) * 100) : score(n);
}

function hasAnyEvidence(evidence?: PurchaseTerritoryEvidence): boolean {
  if (!evidence) return false;
  return [
    evidence.density && evidence.density !== 'unknown',
    evidence.mixityScore,
    evidence.housingQualityScore,
    evidence.greenScore,
    evidence.socialInfrastructureScore,
    evidence.transportAccessScore,
    evidence.safetyScore,
    evidence.prestigeScore,
    evidence.resortLeisureScore,
    evidence.industrialRiskScore,
    evidence.roadNoiseRiskScore,
    evidence.peripheralIsolationScore,
    evidence.overbuildingPressureScore,
    evidence.strBusinessMagnetScore,
    evidence.h3?.countedMagnets,
    evidence.territorialSignals?.countedSignals,
  ].some(value => value !== undefined && value !== false && value !== 0);
}

function evidenceConfidence(evidence: PurchaseTerritoryEvidence): PurchaseTrajectoryConfidence {
  const signalQuality = evidence.territorialSignals?.signalQuality;
  const countedSignals =
    evidence.territorialSignals?.countedSignals ?? evidence.h3?.countedMagnets ?? 0;

  if (signalQuality === 'high' || countedSignals >= 8) return 'high';
  if (signalQuality === 'medium' || countedSignals >= 3) return 'medium';
  return 'low';
}

export function classifyPurchaseTerritory(
  evidence?: PurchaseTerritoryEvidence,
): PurchaseTerritoryClassification {
  if (!hasAnyEvidence(evidence)) {
    return {
      type: 'no_evidence_uncertain',
      confidence: 'low',
      reasons: ['Недостаточно нормализованных признаков территории.'],
    };
  }

  const e = evidence as PurchaseTerritoryEvidence;
  const confidence = evidenceConfidence(e);
  const industrialRisk = Math.max(score(e.industrialRiskScore), score(e.roadNoiseRiskScore));
  const infrastructure = score(e.socialInfrastructureScore);
  const transport = Math.max(
    score(e.transportAccessScore),
    ratioToScore(e.territorialSignals?.transportBalance?.value),
    ratioToScore(e.h3?.businessTravelerSuitability?.hasTransportAccess ? 1 : 0),
  );
  const mixity = Math.max(
    score(e.mixityScore),
    ratioToScore(e.h3?.categoryDiversityScore),
    ratioToScore(e.territorialSignals?.diversity?.value),
  );
  const housing = score(e.housingQualityScore);
  const green = score(e.greenScore);
  const prestige = score(e.prestigeScore);
  const resort = score(e.resortLeisureScore);
  const isolation = Math.max(
    score(e.peripheralIsolationScore),
    ratioToScore(e.territorialSignals?.deadZonePenalty?.gapRatio),
    ratioToScore(e.h3?.deadZones?.gapRatio),
  );

  if (industrialRisk >= 65) {
    return {
      type: 'industrial_or_road_risk_zone',
      confidence,
      reasons: ['Есть выраженный промышленный, дорожный или шумовой риск.'],
    };
  }

  if (e.density === 'high' && mixity >= 55 && infrastructure >= 60 && transport >= 55) {
    return {
      type: 'dense_urban_core',
      confidence,
      reasons: ['Плотная городская среда с высокой смешанностью, инфраструктурой и транспортом.'],
    };
  }

  if (e.density === 'low' && housing >= 70 && (prestige >= 65 || green >= 70) && industrialRisk < 35) {
    return {
      type: 'premium_low_density_residential',
      confidence,
      reasons: ['Низкоплотная качественная жилая среда с сильным образом жизни.'],
    };
  }

  if (resort >= 65 && green >= 55) {
    return {
      type: 'resort_or_leisure_residential',
      confidence,
      reasons: ['Жилая среда связана с рекреацией, отдыхом или природным окружением.'],
    };
  }

  if (infrastructure >= 62 && housing >= 55 && industrialRisk < 45) {
    return {
      type: 'family_residential',
      confidence,
      reasons: ['Семейная жилая среда с заметной социальной инфраструктурой.'],
    };
  }

  if (isolation >= 60 && infrastructure < 45 && transport < 45) {
    return {
      type: 'weak_peripheral_residential',
      confidence,
      reasons: ['Периферийная жилая среда со слабой инфраструктурой или транспортом.'],
    };
  }

  if (e.density === 'low' && transport >= 45 && isolation >= 35) {
    return {
      type: 'suburban_commuter_zone',
      confidence,
      reasons: ['Пригородная жилая зона, где качество покупки зависит от транспорта.'],
    };
  }

  return {
    type: 'mixed_city_residential',
    confidence,
    reasons: ['Смешанная городская жилая среда без доминирующего экстремального риска.'],
  };
}
