# Location Core Engine — MVP Implementation Plan

## Цель MVP

Получить рабочий `CoreLocationProfile` из существующих вычислений с минимальным новым кодом.  
Не переписывать модель. Добавить тонкий слой поверх `LocationAnalysis`.

**Принцип:** `CoreLocationProfile = thin mapping over LocationAnalysis + 3 new sub-modules`

---

## Что уже есть и можно переиспользовать

### Из `LocationAnalysis` (полностью готово)

| Поле в `LocationAnalysis` | Используется в core engine как |
|---|---|
| `evergreenIndex` | → `commercialStrength.breakdown.demandPull` (base) |
| `locationScore.breakdown.demand_score` | → `commercialStrength.score` (composite) |
| `locationScore.breakdown.supply_score` | → `commercialStrength.breakdown.supplyPressure` |
| `locationScore.breakdown.audience_fit_score` | → `audienceFit.ranked[primary].score` |
| `locationScore.breakdown.accessibility_score` | → `commercialStrength.breakdown.accessibilityPull` |
| `locationScore.breakdown.seasonality_score` | → `commercialStrength.breakdown.trafficStability` |
| `gravityExplanation.clusterDetected` | → `commercialStrength.clusterDetected` |
| `gravityExplanation.clusterSize` | → `commercialStrength.clusterSize` |
| `gravityExplanation.demandType` | → `commercialStrength.demandType` |
| `gravityExplanation.competitorPressureLevel` | → supply_pressure band |
| `neighborhoodEnvironment.environmentalFrictionScore` | → `environmentQuality.frictionScore` |
| `neighborhoodEnvironment.concernLevel` | → `environmentQuality.concernLevel` |
| `neighborhoodEnvironment.breakdown` | → `environmentQuality.breakdown` |
| `neighborhoodEnvironment.confidence` | → `environmentQuality.confidence` |
| `audienceAnalysis.primaryAudience` | → `audienceFit.primary` (BUSINESS/TOURIST mapping) |
| `audienceAnalysis.audienceSharePct` | → signal для `business_corporate` score |
| `audienceAnalysis.businessClusterDetected` | → signal для `business_corporate` score |
| `audienceAnalysis.primaryMagnets` | → top magnets для audience scoring |
| `footTraffic.stability01` | → `commercialStrength.breakdown.trafficStability` |
| `locationScore.recommended_strategy` | → base для `strategyFit.recommended` |
| `magnets` (filtered by categoryId) | → audience fit signals |
| `magnetCountByCategory` | → быстрая проверка наличия anchor-категорий |

### Из `LocationScoreOutput` (готово)

- `location_score` → входит в `commercialStrength.score`
- `rating` → маппируется на `commercialStrength.band`
- `top_positive_factors` / `top_negative_factors` → переиспользуются в `CoreExplanation[]`

---

## Три новых под-модуля (то, чего нет)

### Модуль 1: `buildAudienceFitProfile(analysis: LocationAnalysis): AudienceFitProfile`

Входные данные — только поля из существующего `LocationAnalysis`. Новых OSM-запросов не нужно.

**Алгоритм для каждой из 8 аудиторий:**

```typescript
function scoreAudience(type: AudienceType, a: LocationAnalysis): AudienceScore {
  // Каждая аудитория — это набор weighted сигналов (signal + weight + direction)
  // Итоговый score = сумма weighted сигналов, нормализованная в 0–100
}
```

#### `business_corporate` — первая реализация:
```typescript
const signals = [
  { value: a.audienceAnalysis.audienceSharePct,     weight: 0.30 }, // % бизнес-спроса
  { value: a.audienceAnalysis.businessClusterDetected ? 100 : 0, weight: 0.20 },
  { value: a.locationScore.breakdown.audience_fit_score, weight: 0.25 },
  { value: 100 - a.neighborhoodEnvironment.environmentalFrictionScore, weight: 0.15 }, // env quality
  { value: a.locationScore.breakdown.accessibility_score, weight: 0.10 }, // transit
];
// band = score >= 65 → 'strong', >= 40 → 'viable', < 40 → 'weak'
```

#### `transient_transport`:
```typescript
const isTransportLed = a.demandType === 'transport-led';
const hasRail = a.magnetCountByCategory['railway_station'] > 0;
const hasMetro = a.magnets.some(m => m.categoryId === 'metro' && m.distance <= 600);
const transitDensity = a.neighborhoodEnvironment.breakdown.transitCorridor01;

const signals = [
  { value: isTransportLed ? 100 : 30, weight: 0.35 },
  { value: hasRail ? 80 : 0,          weight: 0.25 },
  { value: hasMetro ? 90 : 20,        weight: 0.20 },
  { value: transitDensity * 100,      weight: 0.20 },
];
```

#### `leisure_tourist`:
```typescript
const attractionCount = a.magnetCountByCategory['attraction'] ?? 0;
const isTourismLed = a.demandType === 'tourism-led';
const lowFriction = Math.max(0, 100 - a.neighborhoodEnvironment.environmentalFrictionScore * 1.5);
const hasEntertainment = (a.magnetCountByCategory['entertainment'] ?? 0) > 0;

const signals = [
  { value: Math.min(100, attractionCount * 30), weight: 0.35 },
  { value: isTourismLed ? 100 : 40,             weight: 0.25 },
  { value: lowFriction,                          weight: 0.25 },
  { value: hasEntertainment ? 70 : 20,           weight: 0.15 },
];
```

#### `family_extended`:
```typescript
const nightlife = a.neighborhoodEnvironment.breakdown.nightlife01;
const industrial = a.neighborhoodEnvironment.breakdown.industrial01;
const friction = a.neighborhoodEnvironment.environmentalFrictionScore;
const hasLocalSchool = (a.magnetCountByCategory['education_local'] ?? 0) > 0;
const hasLocalShop = (a.magnetCountByCategory['shopping_local'] ?? 0) > 0;

const envScore = Math.max(0, 100
  - friction * 1.5           // friction penalty, harder than business
  - nightlife * 60           // nightlife penalty
  - industrial * 50          // industrial penalty
);
const signals = [
  { value: envScore,                              weight: 0.50 }, // среда критична
  { value: hasLocalSchool ? 70 : 20,             weight: 0.25 },
  { value: hasLocalShop ? 60 : 15,               weight: 0.15 },
  { value: a.locationScore.breakdown.supply_score, weight: 0.10 }, // low competition
];
```

#### `medical_related`:
```typescript
const hasHospital = (a.magnetCountByCategory['hospital'] ?? 0) > 0;
const topHospital = a.magnets.find(m => m.categoryId === 'hospital');
const hospitalProximityScore = topHospital
  ? Math.max(0, 100 - topHospital.distance / 10)  // 0m→100, 1000m→0
  : 0;
const friction = a.neighborhoodEnvironment.environmentalFrictionScore;

const signals = [
  { value: hospitalProximityScore,                weight: 0.55 }, // ключевой сигнал
  { value: Math.max(0, 80 - friction),            weight: 0.25 },
  { value: a.locationScore.breakdown.accessibility_score, weight: 0.20 },
];
```

#### `premium_comfort`:
```typescript
const friction = a.neighborhoodEnvironment.environmentalFrictionScore;
const nightlife = a.neighborhoodEnvironment.breakdown.nightlife01;
const industrial = a.neighborhoodEnvironment.breakdown.industrial01;
const aviation = a.neighborhoodEnvironment.breakdown.aviation01;
const hasMajorHotel = (a.magnetCountByCategory['major_hotel'] ?? 0) > 0;

// Premium очень чувствительна к среде
const envScore = Math.max(0,
  100
  - friction * 2.0   // double penalty
  - nightlife * 70
  - industrial * 80
  - aviation * 60
);

const signals = [
  { value: envScore,                         weight: 0.55 },
  { value: a.locationScore.breakdown.demand_score, weight: 0.25 },
  { value: hasMajorHotel ? 80 : 30,         weight: 0.20 },
];
```

#### `student_education` и `relocation_midterm`:
Реализуются во второй итерации на основе university-магнитов и mixed-среды.  
Для MVP могут иметь упрощённые эвристики.

---

### Модуль 2: `buildStrategyFitProfile(analysis: LocationAnalysis, audienceFit: AudienceFitProfile): StrategyFitProfile`

**Алгоритм:**

```typescript
function buildStrategyFitProfile(a, audienceFit): StrategyFitProfile {
  const commercial = a.locationScore!.breakdown;
  const friction = a.neighborhoodEnvironment.environmentalFrictionScore;
  const primaryAudience = audienceFit.primary;

  const flags: StrategyDriverFlag[] = [];

  // Collect flags
  if (commercial.demand_score >= 70 && commercial.seasonality_score >= 60)
    flags.push('high_demand_stable');
  if (commercial.demand_score >= 70 && commercial.seasonality_score < 50)
    flags.push('high_demand_volatile');
  if (friction >= 55) flags.push('elevated_friction');
  if (a.gravityExplanation.clusterDetected) flags.push('strong_business_cluster');
  if (a.demandType === 'transport-led') flags.push('transport_corridor');
  if (primaryAudience === 'premium_comfort') flags.push('comfort_sensitive_primary');
  if (commercial.supply_score >= 70) flags.push('low_competition');
  if (commercial.supply_score <= 40) flags.push('high_competition');

  // Strategy ranking via flag scoring matrix
  const scores: Record<StrategyType, number> = {
    short_term: 0,
    hybrid: 0,
    mid_term: 0,
    selective_premium_short: 0,
    cautious_manual: 0,
    unsuitable_full_auto: 0,
  };

  // Apply flag contributions
  if (flags.includes('high_demand_stable')) {
    scores.short_term += 40;
    scores.hybrid += 25;
  }
  if (flags.includes('high_demand_volatile')) {
    scores.hybrid += 35;
    scores.cautious_manual += 20;
  }
  if (flags.includes('elevated_friction')) {
    scores.short_term -= 15;
    scores.selective_premium_short -= 30;
    scores.cautious_manual += 25;
  }
  if (friction >= 70) {
    scores.unsuitable_full_auto += 50;
    scores.cautious_manual += 30;
    scores.short_term -= 30;
  }
  if (flags.includes('comfort_sensitive_primary')) {
    scores.selective_premium_short += 40;
    scores.short_term -= 10;
  }
  if (flags.includes('transport_corridor')) {
    scores.short_term += 30;
    scores.hybrid += 20;
  }
  if (primaryAudience === 'relocation_midterm' || primaryAudience === 'family_extended') {
    scores.mid_term += 40;
    scores.hybrid += 25;
    scores.short_term -= 20;
  }
  if (primaryAudience === 'medical_related') {
    scores.mid_term += 30;
    scores.hybrid += 30;
  }

  // Base level contribution from existing recommended_strategy
  const existing = a.locationScore!.recommended_strategy;
  scores[existing] += 25; // якорь

  // Нормализация + ранжирование
  const ranked = Object.entries(scores)
    .sort(([, a], [, b]) => b - a)
    .map(([strategy, rawScore]) => ({
      strategy: strategy as StrategyType,
      score: Math.max(0, Math.min(100, 50 + rawScore)),
      rationale: buildStrategyRationale(strategy as StrategyType, flags),
      risks: buildStrategyRisks(strategy as StrategyType, a, friction),
    }));

  return {
    recommended: ranked[0].strategy,
    ranked,
    driverFlags: flags,
  };
}
```

---

### Модуль 3: `buildOperationalSuitability(commercial, environment, audienceFit, confidence): OperationalSuitability`

```typescript
function buildOperationalSuitability(
  commercialScore: number,
  frictionScore: number,
  trafficStability: number,
  singleSourceRisk: boolean,
  overallConfidence: 'high' | 'medium' | 'low',
  hasHighConflict: boolean,
): OperationalSuitability {

  const fullAutoConditions = [
    commercialScore >= 65,
    frictionScore <= 44,
    trafficStability >= 55,
    !singleSourceRisk,
    overallConfidence !== 'low',
    !hasHighConflict,
  ];
  const fullAutoMet = fullAutoConditions.every(Boolean);

  const semiAutoConditions = [
    commercialScore >= 45,
    frictionScore <= 64,
    overallConfidence !== 'low',
  ];
  const semiAutoMet = semiAutoConditions.every(Boolean);

  const recommended: OperationalMode =
    fullAutoMet ? 'full_auto' :
    semiAutoMet ? 'semi_auto' :
    'manual';

  return {
    recommended,
    modes: {
      full_auto: {
        suitable: fullAutoMet,
        score: fullAutoMet ? 80 + (commercialScore - 65) * 0.5 : Math.max(0, 40 - (frictionScore - 44)),
        conditions: buildFullAutoConditions(fullAutoConditions),
        risks: buildFullAutoRisks(frictionScore, singleSourceRisk),
      },
      semi_auto: {
        suitable: semiAutoMet,
        score: semiAutoMet ? 60 + commercialScore * 0.2 : 30,
        conditions: ['Regular performance review required', 'Manual override for unusual demand'],
        risks: frictionScore >= 55 ? ['Environmental friction may cause guest quality issues'] : [],
      },
      manual: {
        suitable: true, // всегда возможен
        score: 100 - Math.min(50, commercialScore * 0.5), // лучше для сложных локаций
        conditions: ['Operator expertise required', 'Individual guest selection recommended'],
        risks: [],
      },
    },
  };
}
```

---

## Точка входа: `buildCoreLocationProfile`

```typescript
// src/lib/location/core-engine.ts (NEW FILE)

export function buildCoreLocationProfile(analysis: LocationAnalysis): CoreLocationProfile {
  const locationScore = analysis.locationScore!;
  const env = analysis.neighborhoodEnvironment;
  const commercial = locationScore.breakdown;

  // 1. Commercial Strength — mapping только
  const commercialStrength = mapCommercialStrength(analysis, locationScore);

  // 2. Environment Quality — mapping только
  const environmentQuality = mapEnvironmentQuality(env);

  // 3. Audience Fit — NEW (Module 1)
  const audienceFit = buildAudienceFitProfile(analysis);

  // 4. Strategy Fit — NEW (Module 2)
  const strategyFit = buildStrategyFitProfile(analysis, audienceFit);

  // 5. Operational Suitability — NEW (Module 3)
  const singleSourceRisk = detectSingleSourceRisk(analysis.magnets);
  const hasHighConflict = audienceFit.conflicts.some(c => c.severity === 'high');
  const operationalSuitability = buildOperationalSuitability(
    commercialStrength.score,
    env.environmentalFrictionScore,
    commercial.seasonality_score,
    singleSourceRisk,
    env.confidence,
    hasHighConflict,
  );

  // 6. Confidence + Warnings
  const confidence = buildCoreConfidence(analysis, env);
  const warnings = buildCoreWarnings(commercialStrength, env, audienceFit, operationalSuitability);

  return {
    analysisId: `${Date.now()}-${Math.round(analysis.evergreenIndex)}`,
    lat: 0, // передаётся извне
    lon: 0,
    computedAt: new Date().toISOString(),
    commercialStrength,
    environmentQuality,
    audienceFit,
    strategyFit,
    operationalSuitability,
    confidence,
    warnings,
    explanations: [],
    sourceAnalysis: analysis,
  };
}
```

---

## Файловая структура MVP

```
src/lib/location/
├── core-engine.ts              ← НОВЫЙ: buildCoreLocationProfile()
├── core-engine-audience.ts     ← НОВЫЙ: buildAudienceFitProfile() (Module 1)
├── core-engine-strategy.ts     ← НОВЫЙ: buildStrategyFitProfile() (Module 2)
├── core-engine-operational.ts  ← НОВЫЙ: buildOperationalSuitability() (Module 3)
├── core-engine-types.ts        ← НОВЫЙ: все интерфейсы из spec
├── types.ts                    ← существующий (добавить re-export новых типов)
├── gravity-scoring.ts          ← без изменений
├── location-score.ts           ← без изменений
├── neighborhood-environment.ts ← без изменений
└── ... (остальные существующие)
```

---

## Порядок реализации (итерации)

### Итерация 1 (быстрая, ~1 день)
1. Создать `core-engine-types.ts` — все интерфейсы
2. Создать `core-engine-audience.ts` — `business_corporate`, `transient_transport`, `leisure_tourist`, `premium_comfort`
3. Создать `core-engine-operational.ts` — `buildOperationalSuitability`
4. Создать `core-engine.ts` — `buildCoreLocationProfile` с mapping только

### Итерация 2 (~0.5 дня)
5. Создать `core-engine-strategy.ts` — `buildStrategyFitProfile` с flag matrix
6. Добавить `family_extended` и `medical_related` в audience scoring
7. Добавить `CoreWarning[]` генерацию

### Итерация 3 (опционально)
8. `student_education` и `relocation_midterm`
9. `AudienceConflict[]` pairwise логика
10. `CoreExplanation[]` генерация

---

## Что НЕ нужно делать в MVP

- Не трогать `buildAnalysis()` или demo-компоненты
- Не делать новых OSM-запросов
- Не изменять существующие интерфейсы в `types.ts`
- Не добавлять новый UI
- Не запускать 100-case validation сразу (сначала протестировать на 5–10 известных локациях)

---

## Быстрая проверка MVP

После реализации проверить на 5 локациях с известными характеристиками:

| Локация-тип | Ожидаемый primary audience | Ожидаемый режим | Ожидаемая стратегия |
|---|---|---|---|
| Деловой центр (офисный квартал) | `business_corporate` | `full_auto` или `semi_auto` | `short_term` |
| Аэровокзальный район | `transient_transport` | `semi_auto` | `short_term` или `hybrid` |
| Исторический центр, тихий | `leisure_tourist` + `premium_comfort` | `full_auto` | `selective_premium_short` |
| Промышленная зона, сильный спрос | `business_corporate` (weak fit) | `manual` | `cautious_manual` |
| Медицинский кластер | `medical_related` | `semi_auto` | `hybrid` или `mid_term` |
