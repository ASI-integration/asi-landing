# Location Core Engine — Architecture Specification

## 1. Зачем нужен отдельный core engine

Текущая модель отвечает на один вопрос: «насколько хороша эта локация?»  
Ответ — единый `location_score` (0–100) плюс стратегия `short_term / hybrid / mid_term`.

Этого достаточно для demo-слоя на главной странице. Но недостаточно для продукта:

- Одинаковый score у двух разных локаций не означает, что они подходят одной стратегии.
- Локация «93 из 100» может быть опасна для full-auto, если в ней высокий friction и нестабильная аудитория.
- Локация «68 из 100» может отлично подходить для ручного premium-позиционирования.
- Выбор целевой аудитории, каналов и ценовой стратегии требует более детального профиля.

Core engine — это внутренний профиль локации с несколькими отдельными измерениями.  
Он не заменяет demo-слой, а лежит под ним и под будущей decision-логикой.

---

## 2. Чем он отличается от demo-layer

| Параметр | Demo-layer | Core engine |
|---|---|---|
| Назначение | Конверсия, объяснение пользователю | Внутренняя логика, стратегии, автоматика |
| Выход | Один `location_score` + 3 стратегии + explanation | Многомерный профиль: 5+ измерений |
| Аудитория | Один `primaryAudience`: BUSINESS/TOURIST/FAMILY | Ранжированный список из 8 типов с сигналами |
| Стратегия | `short_term / hybrid / mid_term` | Расширенный набор + selective / cautious / manual-only |
| Операционность | Нет | Явный флаг: manual / semi-auto / full-auto |
| Детализация | Упрощённая для читаемости | Внутренние reason codes, threshold flags, warnings |
| Confidence | Один флаг `confidence` в neighbor-env | Покомпонентные confidence + uncertainty flags |

---

## 3. Ключевые сущности и поля

### 3.1 `CoreLocationProfile` — главный объект

```typescript
interface CoreLocationProfile {
  // Уникальный идентификатор анализа
  analysisId: string;
  lat: number;
  lon: number;
  computedAt: string; // ISO timestamp

  // Пять основных измерений
  commercialStrength:      CommercialStrength;
  environmentQuality:      EnvironmentQuality;
  audienceFit:             AudienceFitProfile;
  strategyFit:             StrategyFitProfile;
  operationalSuitability:  OperationalSuitability;

  // Мета-уровень
  confidence:   CoreConfidence;
  warnings:     CoreWarning[];
  explanations: CoreExplanation[];

  // Связь с существующей моделью (backward-compat)
  sourceAnalysis?: LocationAnalysis;
}
```

---

### 3.2 `CommercialStrength` — коммерческая сила

Отвечает на вопрос: *насколько сильны коммерческие сигналы вокруг этой точки?*

```typescript
interface CommercialStrength {
  /** 0–100 — итоговая коммерческая сила (не равна location_score из demo) */
  score: number;

  /** Ранг: exceptional | strong | viable | weak | risky */
  band: CommercialBand;

  breakdown: {
    demandPull:        number; // 0–100: суммарная гравитация магнитов
    supplyPressure:    number; // 0–100: давление конкурентов (инвертировано)
    clusterBonus:      number; // 0–100: кластерный эффект
    accessibilityPull: number; // 0–100: транспортная доступность
    trafficStability:  number; // 0–100: стабильность потока (из foot-traffic)
  };

  /** Тип спроса: tourism-led | business-led | transport-led | mixed */
  demandType: DemandType;

  /** Магниты, которые вносят наибольший вклад */
  topMagnets: MagnetItem[];

  /** Признаки кластерного эффекта */
  clusterDetected: boolean;
  clusterSize: number;

  /** true если demand очень сконцентрирован на одном источнике (риск зависимости) */
  singleSourceRisk: boolean;

  reasons: string[]; // EN reason codes
}
```

---

### 3.3 `EnvironmentQuality` — качество среды / friction

Отвечает на вопрос: *какова нагрузка физической среды и что это означает для аудитории?*

```typescript
interface EnvironmentQuality {
  /** 0–100 — чем выше, тем хуже (friction score, не comfort) */
  frictionScore: number;

  /** low | moderate | elevated | high */
  concernLevel: NeighborhoodEnvironmentConcernLevel;

  breakdown: {
    roads:       number; // 0–1
    industrial:  number; // 0–1
    aviation:    number; // 0–1
    nightlife:   number; // 0–1
    transit:     number; // 0–1
    stackEffect: number; // 0–1 (совместный эффект нескольких факторов)
  };

  /** Аудитории, для которых эта среда является проблемой */
  problematicFor: AudienceType[];

  /** Аудитории, для которых эта среда нейтральна или плюс */
  acceptableFor: AudienceType[];

  /** OSM confidence */
  confidence: 'high' | 'medium' | 'low';

  narrativeEn: string;
  narrativeRu: string;
}
```

---

### 3.4 `AudienceFitProfile` — профиль пригодности по аудиториям

Отвечает на вопрос: *для кого эта локация хороша, для кого спорна, для кого слабая?*

Полная спецификация — в разделе 4.

```typescript
interface AudienceFitProfile {
  /** Ранжированный список из всех релевантных аудиторий */
  ranked: AudienceScore[];

  /** Первичная аудитория (наибольший fit) */
  primary: AudienceType;

  /** Вторичная аудитория (если fit ≥ 50) */
  secondary?: AudienceType;

  /** Аудитории, для которых локация явно слабая (fit < 30) */
  poorFit: AudienceType[];

  /** Конфликты аудиторий (e.g. transit-noise vs premium-comfort) */
  conflicts: AudienceConflict[];

  /** Общий confidence оценки аудитории */
  confidence: 'high' | 'medium' | 'low';
}

interface AudienceScore {
  audience:   AudienceType;
  score:      number;  // 0–100
  band:       'strong' | 'viable' | 'weak';
  positives:  string[]; // сигналы в пользу этой аудитории
  negatives:  string[]; // сигналы против
}

interface AudienceConflict {
  audienceA: AudienceType;
  audienceB: AudienceType;
  reason:    string;
  severity:  'low' | 'medium' | 'high';
}
```

---

### 3.5 `StrategyFitProfile` — профиль пригодности по стратегиям

Полная спецификация — в разделе 5.

```typescript
interface StrategyFitProfile {
  /** Рекомендуемая стратегия */
  recommended: StrategyType;

  /** Ранжированный список стратегий с обоснованием */
  ranked: StrategyScore[];

  /** Признаки, на основе которых выбрана стратегия */
  driverFlags: StrategyDriverFlag[];
}

type StrategyType =
  | 'short_term'
  | 'hybrid'
  | 'mid_term'
  | 'selective_premium_short'
  | 'cautious_manual'
  | 'unsuitable_full_auto';

interface StrategyScore {
  strategy:   StrategyType;
  score:      number; // 0–100 — насколько стратегия подходит
  rationale:  string;
  risks:      string[];
}

type StrategyDriverFlag =
  | 'high_demand_stable'
  | 'high_demand_volatile'
  | 'elevated_friction'
  | 'strong_tourism_anchor'
  | 'strong_business_cluster'
  | 'comfort_sensitive_primary'
  | 'low_competition'
  | 'high_competition'
  | 'single_source_demand'
  | 'mixed_demand_split'
  | 'transport_corridor'
  | 'mid_term_anchor_nearby';
```

---

### 3.6 `OperationalSuitability` — операционная пригодность

Полная спецификация — в разделе 6.

```typescript
interface OperationalSuitability {
  /** Рекомендуемый режим управления */
  recommended: OperationalMode;

  modes: {
    manual:     OperationalModeScore;
    semi_auto:  OperationalModeScore;
    full_auto:  OperationalModeScore;
  };
}

type OperationalMode = 'manual' | 'semi_auto' | 'full_auto';

interface OperationalModeScore {
  suitable:   boolean;
  score:      number; // 0–100
  conditions: string[]; // при каких условиях режим допустим
  risks:      string[]; // риски этого режима для данной локации
}
```

---

### 3.7 `CoreConfidence` и `CoreWarning`

```typescript
interface CoreConfidence {
  /** Общий уровень уверенности в профиле */
  overall: 'high' | 'medium' | 'low';

  /** Покомпонентные confidence */
  commercial:    'high' | 'medium' | 'low';
  environment:   'high' | 'medium' | 'low';
  audienceFit:   'high' | 'medium' | 'low';
  osmCoverage:   number; // 0–100 количество OSM элементов как прокси полноты
}

interface CoreWarning {
  code:     WarningCode;
  severity: 'info' | 'warn' | 'critical';
  messageEn: string;
  messageRu: string;
}

type WarningCode =
  | 'sparse_osm_data'
  | 'single_source_demand_risk'
  | 'high_friction_strong_demand'  // конфликт коммерческой силы и среды
  | 'audience_conflict_detected'
  | 'strategy_mismatch_env'        // рекомендованная стратегия конфликтует со средой
  | 'full_auto_not_recommended'
  | 'comfort_sensitive_high_friction'
  | 'transport_only_demand_risk';
```

---

## 4. Audience Fit — детальная спецификация

### 4.1 Типы аудиторий (v1)

```typescript
type AudienceType =
  | 'business_corporate'       // командированные, корпоративные гости
  | 'transient_transport'      // транзитные, transport-driven
  | 'leisure_tourist'          // туристы, досуговые
  | 'family_extended'          // семьи, длительные размещения
  | 'medical_related'          // медицинский туризм, сопровождающие пациентов
  | 'student_education'        // студенты, образовательный поток
  | 'relocation_midterm'       // переезжающие, среднесрочная аренда
  | 'premium_comfort'          // премиум, comfort-sensitive
```

### 4.2 Сигналы по каждой аудитории

#### `business_corporate`
**Позитивные сигналы:**
- Кластер бизнес-магнитов (office, factory, convention) в 1 км
- `audienceSharePct ≥ 55` в сторону business
- Конгресс/выставочный центр в 800 м
- Metro в 1.5 км (доступность без авто)
- Умеренный `frictionScore` (≤ 44): деловые гости терпимее к городскому шуму, но не к экстремальному

**Негативные сигналы:**
- `frictionScore ≥ 65`: очень высокая нагрузка среды
- Нет ни одного business-магнита в 1.2 км
- `demandType === 'tourism-led'` без компенсирующих бизнес-якорей
- `singleSourceRisk` на одном factory/industrial

---

#### `transient_transport`
**Позитивные сигналы:**
- `demandType === 'transport-led'`
- Ж/д станция ≤ 800 м или аэропорт ≤ 2 км
- Metro ≤ 600 м
- Высокая плотность transit-stops (`transitCorridor01 ≥ 0.6`)

**Негативные сигналы:**
- Нет ни одного transit-магнита
- `frictionScore ≥ 75` (экстремальная нагрузка даже для транзита неприятна)
- Единственный источник: marginal airport без city-scale охвата

---

#### `leisure_tourist`
**Позитивные сигналы:**
- `attractionCount ≥ 2` в 1 км
- `demandType === 'tourism-led'`
- Entertainment, shopping_major, stadium в доступности
- Умеренный friction (≤ 44): туристы ценят атмосферу

**Негативные сигналы:**
- `frictionScore ≥ 55`: высокий шум / промышленность плохо читается туристами
- `attractionCount === 0`
- Доминирующий industrial / factory stack
- Аэропорт без других туристических якорей (transport, не leisure)

---

#### `family_extended`
**Позитивные сигналы:**
- `frictionScore ≤ 30` (спокойная среда)
- education_local в 650 м
- shopping_local в 450 м
- Умеренная конкуренция (меньше шума вокруг)
- Нет ночных заведений (`nightlife01 ≤ 0.2`)

**Негативные сигналы:**
- `frictionScore ≥ 45` — критично для семей
- `nightlife01 ≥ 0.5` — ночной шум
- `industrial01 ≥ 0.4` — промышленная близость
- Аэропорт в 1 км

---

#### `medical_related`
**Позитивные сигналы:**
- Hospital в 1 км (categoryId: 'hospital')
- `demandType` включает hospital-contribution
- Умеренная среда (friction ≤ 44)
- Транспортная доступность (metro или bus)

**Негативные сигналы:**
- Нет hospital-магнита вовсе
- `frictionScore ≥ 55`
- `nightlife01 ≥ 0.5`

---

#### `student_education`
**Позитивные сигналы:**
- University в 1 км
- `education_local` доступны
- transit-доступность (metro, bus)
- Умеренный competition уровень

**Негативные сигналы:**
- Нет university в 1.5 км
- `frictionScore ≥ 60` (студенты менее толерантны к тяжёлой промышленной среде)

---

#### `relocation_midterm`
**Позитивные сигналы:**
- Смешанная среда: shopping_local + education_local + transit
- `frictionScore ≤ 40`
- Умеренный commercial score (не обязательно топовый)
- `demandType === 'mixed'` — разнообразная среда
- Низкая конкуренция (меньше шума, стабильнее)

**Негативные сигналы:**
- `frictionScore ≥ 55`
- Highly specialized locations (чисто airport или чисто industrial)
- `nightlife01 ≥ 0.6`

---

#### `premium_comfort`
**Позитивные сигналы:**
- `frictionScore ≤ 24` (только low concern)
- Attraction / entertainment без nightlife шума
- Strong `commercialStrength.score ≥ 70`
- Нет industrial, нет freight, нет motorway рядом
- Major hotel в зоне (quality proxy)

**Негативные сигналы:**
- `frictionScore ≥ 35` — критично для этой аудитории
- `industrial01 ≥ 0.3`
- `nightlife01 ≥ 0.4`
- `aviation01 ≥ 0.3`
- `transitCorridor01 ≥ 0.7` (слишком шумный транзитный коридор)

---

### 4.3 Audience Conflicts (первая версия)

| Конфликт | Причина | Severity |
|---|---|---|
| `transient_transport` vs `premium_comfort` | Транзитная зона = шум, нестабильность | medium |
| `leisure_tourist` vs `family_extended` | Nightlife, entertainment noise | medium |
| `business_corporate` vs `relocation_midterm` | Разная ценовая стратегия, разный цикл | low |
| `premium_comfort` vs `medical_related` | Медицинский поток ≠ комфортная среда | low |
| `transport_corridor` среда vs `family_extended` | Физическое противоречие | high |
| `industrial_zone` среда vs `premium_comfort` | Принципиальное противоречие | high |

---

## 5. Strategy Fit — детальная спецификация

### 5.1 Стратегии

| Стратегия | Описание |
|---|---|
| `short_term` | Краткосрочная, высокий оборот, максимизация ADR через загрузку |
| `hybrid` | Смешанная: STR + mid-term в низкий сезон |
| `mid_term` | Средний срок: 30–90 дней, менее волатильно |
| `selective_premium_short` | Короткий срок, но только для premium-аудитории, ограниченный спрос |
| `cautious_manual` | Ручной подбор, нестандартная локация, требует индивидуального подхода |
| `unsuitable_full_auto` | Автоматика противопоказана, только с ручным контролем |

### 5.2 Матрица выбора стратегии

Стратегия выводится из **комбинации** следующих факторов:

| Фактор | Как влияет |
|---|---|
| `commercialStrength.score ≥ 75` | Открывает `short_term` и `selective_premium_short` |
| `demandType === 'transport-led'` | Предпочтение `short_term` или `hybrid`, но часто volatiе |
| `demandType === 'business-led'` | `short_term` если cluster, `hybrid` иначе |
| `demandType === 'tourism-led'` | `short_term` если attractions strong, `selective_premium_short` если friction low |
| `frictionScore ≥ 55` | Сдвиг от premium к mass/transient, ограничение для `selective_premium_short` |
| `frictionScore ≥ 70` | `cautious_manual` или `unsuitable_full_auto` для comfort-sensitive аудитории |
| `audienceFit.primary === 'premium_comfort'` | Усиливает `selective_premium_short` |
| `audienceFit.primary === 'relocation_midterm'` | Предпочтение `mid_term` или `hybrid` |
| `audienceFit.primary === 'family_extended'` | Предпочтение `mid_term` |
| `singleSourceRisk === true` | Осторожность, `cautious_manual` |
| `trafficStability ≤ 40` | Сдвиг к `hybrid` или `mid_term` |
| Конкуренция high + commercial score < 65 | `mid_term` или `cautious_manual` |

### 5.3 Примеры strategy logic

```
Сильный деловой кластер + stable traffic + friction ≤ 44:
→ short_term (основная) + hybrid (резервная)

Транспортный узел + высокий turnover + friction 45–65:
→ short_term (основная) + cautious_manual warnings

Туристическая локация + low friction + major attractions:
→ selective_premium_short + short_term

Медицинский anchor + mixed environment + no cluster:
→ hybrid или mid_term

Высокий friction (≥ 70) + strong commercial:
→ unsuitable_full_auto, cautious_manual рекомендован

Слабый commercial + no clear audience + high friction:
→ cautious_manual + возможно mid_term
```

---

## 6. Operational Suitability — детальная спецификация

### 6.1 Режимы управления

| Режим | Описание |
|---|---|
| `manual` | Каждое решение принимается вручную: ценообразование, подбор гостей, стратегия |
| `semi_auto` | Автоматика ценообразования и базовых правил, но ручной надзор за нестандартными ситуациями |
| `full_auto` | Полная автоматика: pricing, гостевой поток, стратегические параметры без вмешательства |

### 6.2 Критерии допуска к full_auto

Full automation рекомендована **только** при выполнении **всех** условий:

1. `commercialStrength.score ≥ 65` (предсказуемый устойчивый спрос)
2. `frictionScore ≤ 44` (нет высоких рисков среды)
3. `trafficStability ≥ 55` (стабильный поток)
4. `singleSourceRisk === false` (нет зависимости от одного источника)
5. `confidence.overall !== 'low'` (достаточно данных)
6. Нет active `CoreWarning` с `severity === 'critical'`
7. `audienceFit.conflicts` не содержит `severity === 'high'`

### 6.3 Критерии для semi_auto

Semi-auto допустима при:
- `commercialStrength.score ≥ 45`
- `frictionScore ≤ 64`
- `confidence.overall !== 'low'`

### 6.4 Всегда manual

Manual-only обязателен при любом из:
- `frictionScore ≥ 70`
- `singleSourceRisk === true` при `commercialStrength.score < 50`
- `confidence.overall === 'low'`
- Критические `CoreWarning` активны
- `commercialStrength.score < 35`

### 6.5 Логика выбора рекомендованного режима

```
if full_auto conditions met → 'full_auto'
else if semi_auto conditions met → 'semi_auto'
else → 'manual'
```

---

## 7. Confidence / Warnings / Uncertainty

### 7.1 Принципы confidence

- Confidence **не** передаётся в demo-output в полном объёме — там только общий флаг.
- В core engine confidence покомпонентный: можно доверять commercial score, но не audience fit (мало OSM).
- Low confidence не блокирует вывод, но добавляет warning и снижает `operationalSuitability.recommended`.

### 7.2 Основные warnings (первая версия)

| Code | Trigger | Severity |
|---|---|---|
| `sparse_osm_data` | `osmElementCount < 15` | warn |
| `single_source_demand_risk` | Один магнит даёт > 70% attraction score | warn |
| `high_friction_strong_demand` | `frictionScore ≥ 55` AND `commercial.score ≥ 70` | warn |
| `audience_conflict_detected` | conflict severity == 'high' | warn |
| `strategy_mismatch_env` | Recommended strategy требует low friction, но friction elevated | warn |
| `full_auto_not_recommended` | full_auto conditions not met | info |
| `comfort_sensitive_high_friction` | primary audience = premium_comfort AND frictionScore ≥ 35 | critical |
| `transport_only_demand_risk` | demandType = transport-led AND нет других магнитов | warn |

---

## 8. Что можно реализовать быстро (Phase 1)

### Готово к использованию из существующей модели:

- `commercialStrength` — практически полностью из `evergreenIndex` + `locationScore.breakdown`
- `environmentQuality` — из `neighborhoodEnvironment` (уже есть `frictionScore`, `breakdown`, `confidence`)
- `audienceFit.business_corporate` и `audienceFit.transient_transport` — из `audienceAnalysis` + `demandType`
- `audienceFit.leisure_tourist` — из `attractionCount` + `demandType === 'tourism-led'`
- `strategyFit.recommended` — расширение существующей `recommendStrategy()`
- `operationalSuitability` — новая логика, но использует уже вычисленные поля

### Что требует нового кода:

- `audienceFit.medical_related`, `family_extended`, `premium_comfort`, `relocation_midterm` — новые сигналы из существующих полей
- `StrategyDriverFlag[]` — новый enum + mapping из существующих полей
- `CoreWarning[]` — новый layer поверх существующих вычислений
- `AudienceConflict[]` — новая логика на основе pairwise правил

---

## 9. Что лучше оставить на Phase 2

- **Динамические audience weights** — сезонные корректировки (летом больше туристов, зимой больше бизнеса)
- **Demand volatility scoring** — оценка волатильности по времени (requires historical data)
- **Competition profile depth** — типы конкурентов, их позиционирование (сейчас только count)
- **Micro-location variance** — оценка разброса качества внутри района (несколько точек)
- **Confidence ML calibration** — обучение модели на реальных данных загрузки
- **External market signals** — интеграция с Airbnb/Booking API для рыночной валидации
- **Relocation/mid-term demand signals** — специфические OSM прокси (бизнес-центры аренды, МФЦ, etc.)
- **Premium signal refinement** — архитектурный класс здания, тип застройки как прокси
