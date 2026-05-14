import type {
  FutureTrajectoryDirection,
  PurchaseTerritoryType,
  ResidentialPurchaseExplanation,
  ResidentialPurchaseScoreInput,
  PurchaseScoreDimensions,
} from './types';

function directionRu(direction: FutureTrajectoryDirection): string {
  switch (direction) {
    case 'strengthening':
      return 'траектория района выглядит усиливающейся';
    case 'stable':
      return 'район выглядит устойчивым';
    case 'declining':
      return 'есть признаки ослабления территории';
    case 'high_risk':
      return 'негативные факторы требуют особой осторожности';
    case 'uncertain':
      return 'данных недостаточно для уверенного долгосрочного вывода';
  }
}

function territoryRu(type: PurchaseTerritoryType): string {
  switch (type) {
    case 'dense_urban_core':
      return 'плотная городская среда';
    case 'mixed_city_residential':
      return 'смешанная жилая городская среда';
    case 'family_residential':
      return 'семейная жилая среда';
    case 'premium_low_density_residential':
      return 'низкоплотная статусная жилая среда';
    case 'resort_or_leisure_residential':
      return 'рекреационная жилая среда';
    case 'suburban_commuter_zone':
      return 'пригородная зона с зависимостью от транспорта';
    case 'weak_peripheral_residential':
      return 'слабая периферийная жилая среда';
    case 'industrial_or_road_risk_zone':
      return 'зона промышленного, дорожного или шумового риска';
    case 'no_evidence_uncertain':
      return 'территория с недостатком проверенных данных';
  }
}

function pushIf(out: string[], condition: boolean, line: string): void {
  if (condition) out.push(line);
}

export function buildResidentialPurchaseExplanation(args: {
  input: ResidentialPurchaseScoreInput;
  dimensions: PurchaseScoreDimensions;
  territoryType: PurchaseTerritoryType;
  trajectoryDirection: FutureTrajectoryDirection;
  currentScore: number;
}): ResidentialPurchaseExplanation {
  const { input, dimensions, territoryType, trajectoryDirection } = args;
  const strengthsRu: string[] = [];
  const risksRu: string[] = [];
  const notesRu: string[] = [];

  pushIf(
    strengthsRu,
    dimensions.liquidityScore >= 68,
    'Сильная ликвидность: объект проще объяснить будущему покупателю.',
  );
  pushIf(
    strengthsRu,
    dimensions.livingQualityScore >= 68,
    'Хорошее качество владения: спокойная среда, жилье и повседневный комфорт.',
  );
  pushIf(
    strengthsRu,
    dimensions.ecologyScore >= 68,
    'Экология и зеленая среда поддерживают сценарий покупки для жизни.',
  );
  pushIf(
    strengthsRu,
    territoryType === 'premium_low_density_residential',
    'Локация слабее для посуточной аренды, но может быть интересна для покупки за счет спокойной жилой среды, зелени и ликвидного направления.',
  );
  pushIf(
    strengthsRu,
    dimensions.futureUpsideScore >= 55,
    'Текущая инфраструктура может быть средней, но долгосрочная траектория района усиливается подтвержденными градостроительными сигналами.',
  );

  pushIf(
    risksRu,
    dimensions.riskPenalty >= 45,
    'Есть факторы риска, которые могут ухудшать качество владения или перепродажу.',
  );
  pushIf(
    risksRu,
    dimensions.overbuildingRiskScore >= 55,
    'Риск переуплотнения может давить на социальную инфраструктуру и ликвидность.',
  );
  pushIf(
    risksRu,
    dimensions.declineRiskScore >= 55,
    'Негативные сигналы повышают риск слабой долгосрочной динамики.',
  );
  pushIf(
    risksRu,
    territoryType === 'no_evidence_uncertain',
    'Данных мало: это неопределенность, а не автоматический минус локации.',
  );

  if ((input.territory?.strBusinessMagnetScore ?? 0) < 35 && dimensions.livingQualityScore >= 60) {
    notesRu.push(
      'Мало STR-магнитов не означает плохую покупку: для владения важнее качество среды, ликвидность и риски.',
    );
  }

  if (dimensions.prestigeLifestyleScore >= 70) {
    notesRu.push(
      'Высокая цена объекта может объясняться не потоком арендаторов, а качеством владения: статус района, экология, безопасность и ограниченное предложение.',
    );
  }

  if ((input.earlyWarningSignals?.length ?? 0) > 0) {
    notesRu.push(
      'Будущие проекты не считаются гарантией роста цены; они повышают потенциал только при достаточной уверенности источников.',
    );
  }

  const summaryRu = `Для покупки это ${territoryRu(territoryType)}; ${directionRu(trajectoryDirection)}.`;

  return {
    summaryRu,
    strengthsRu,
    risksRu,
    notesRu,
  };
}
