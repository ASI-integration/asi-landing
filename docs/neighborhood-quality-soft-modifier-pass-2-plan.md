# Neighborhood quality — soft modifier pass-2 calibration plan

> Дата: 2026-04-18.  
> Артефакты: `scripts/neighborhood-quality-control-results.json`,  
> `scripts/neighborhood-quality-soft-modifier-missing-retry.json`,  
> `docs/neighborhood-quality-soft-modifier-pass.md`,  
> `docs/neighborhood-quality-validation.md`.  
> Метод: пересчёт снимков по зафиксированным данным control-набора + симуляция кандидатных режимов без нового global run.

---

## Что сейчас работает хорошо

| Механизм | Почему правильно |
|-----------|-----------------|
| `low` concern → только текст | Copacabana (EV 100, NE 10) не получает штрафа — корректно. |
| `moderate` → только нарратив | Times Square (74), Causeway Bay (80), Brickell (92) не штрафуются — правильно: их moderate NE частично является следствием собственной коммерческой плотности. |
| confidence=low → нет штрафа | Защита от шума при слабой уверенности NE-подмодели. |
| OSM threshold ≥ 10 | Защита от sparse-выборок (эффект виден на LIC-таймаут кейсе). |
| Потолок maxPointReduction = 9 | Предотвращает экстремальный штраф в одном проходе. |
| `elevated`+high → −3…−5 pts | Ozone Park (100→95), Lyubertsy (88→84), Sochi (65→62) — направление верное. |

---

## Что сейчас слишком мягко

### 1. Elevated penalty (4.5%) недостаточна для strong-диапазона

Lyubertsy (EV 96, base 88, elevated/high): штраф −4 → headline 84. Остаётся **strong**. Для локации-«слабый suburb» 84 выглядит избыточно оптимистично. Проблема не в том, что направление неверно — проблема в том, что 4.5% на базе 88 даёт только 4 pts. При 6% давало бы 5 pts → 83. При 7% → 6 pts → 82. Каждая ступень смотрится реалистичнее.

Ozone Park (EV 97, base 100, elevated/high): −5 pts → 95 (exceptional). EV = 97 — это настоящий сильный транзитный сигнал, поэтому 95 оправдан более чем для Люберец, но 100→95 при `elevated` среде всё ещё выглядит слегка идеально для аэропортного пригорода с промкой.

**Вывод:** поднять `elevated`+high с 4.5% до 6%.

### 2. Floor 70 слишком щедрый при `high` concern

Cannes (EV 100, base 71, high/high, NE-friction 77): номинал 8% × 71 = 5.7 → 6 pts, но пол 70 обрезает до 1 pt (71→70). Итог: штраф −1 вместо −6. Для локации с NE=77 и стеком road+industrial+nightlife+transit+harshStack это сводит весь high-concern level к нулевому эффекту — как будто high идентичен moderate.

Причина: Cannes едва попал в strong (71 — нижняя граница), поэтому пол 70 начинает работать сразу, лишая high-tier возможности сделать что-то значимое.

**Вывод:** differentiate floor по concern level. Для `high` tier снизить пол до 67 (или убрать вовсе). Для `elevated` — оставить 70.

---

## Что сейчас слишком жёстко

Ничего. Единственный кейс, где можно было бы опасаться чрезмерного штрафа — Cannes, но там пол 70 *чрезмерно защищает*, а не штрафует.

Все `moderate` и `low` кейсы без изменений — это не «слишком жёстко», это правильно.

Сочи (base 65, elevated, −3): с pass-2 будет −4 (65→61). Остаётся viable. Допустимо: EV=63 тоже указывает на medium-band.

---

## Анализ moderate / elevated / high по контрольному набору

### Moderate (12 кейсов) — только текст, правильно

| Кейс | Base | EV | NE-friction | Verdict |
|------|------|----|-------------|---------|
| Times Square | 74 | 100 | 32 | EV > base → genuine strong, narrative OK |
| Causeway Bay | 80 | 100 | 43 | Genuine CBD, no penalty correct |
| Kazan center | 80 | 100 | 30 | Genuine regional center, correct |
| Canary Wharf | 76 | 65 | 43 | Medium EV but moderate NE, correct |
| Miami Brickell | 92 | 100 | 41 | Genuine CBD, correct |
| El Poblado | 62 | 80 | 44 | Already viable, moderate narrated |
| Dubai Marina | 47 | 23 | 37 | Already weak, modifier won't help |
| Downtown Brooklyn | 88 | 81 | 43 | Genuine strong urban, correct |
| **Pechatniki** | **89** | **56** | **37** | **⚠ False premium: EV 56 vs headline 89** |
| Copacabana | 79 | 100 | 10 | low concern anyway |

**Pechatniki** — самый проблемный moderate-кейс: EV=56 (medium) но headline=89 (exceptional), industrial OSM 80%. Однако moderate NE с friction=37 корректно идентифицирует среду — это **проблема коммерческой модели**, а не NE слоя. Добавить moderate penalty без доступа к evergreenIndex в modifier небезопасно: любой числовой порог, достаточный для Pechatniki (−3 pts), ударит по Times Square, Brickell, Downtown Brooklyn. **Рекомендация: moderate → только текст в pass-2, flagged для pass-3 с EV-gating.**

### Elevated (3 кейса)

| Кейс | Base | EV | NE-friction | Current | Pass-2 (6%) | Gap |
|------|------|----|-------------|---------|-------------|-----|
| Ozone Park | 100 | 97 | 45 | −5 → 95 | −6 → 94 | −1 |
| Lyubertsy | 88 | 96 | 54 | −4 → 84 | −5 → 83 | −1 |
| Sochi | 65 | 63 | 61 | −3 → 62 | −4 → 61 | −1 |

Все три — улучшение в правильном направлении. Никаких прыжков через rating band (Sochi 61 остаётся viable, Lyubertsy 83 и Ozone Park 94 в strong/exceptional).

### High (1 кейс — Cannes)

| Кейс | Base | EV | NE-friction | Current | Pass-2 (floor 67) | Gap |
|------|------|----|-------------|---------|-------------------|-----|
| Cannes | 71 | 100 | 77 | −1 → 70 (floored!) | −4 → 67 (floor=67) | −3 |

Cannes — единственный high-tier кейс с base ≥ 70 в контроле. При floor=67 получается 71 − min(6, 71−67=4) = 67. Остаётся **около нижней границы strong-диапазона или сразу под ней** (зависит от того, где проходит band boundary). EV=100 означает реальный туристический спрос — переход в 67 обоснован при NE=77+high.

---

## Анализ headline floor (детально)

### Текущая логика
```
if base >= 70:
    max_cut = base - 70
    pointsRemoved = min(pointsRemoved, max_cut)
```

### Проблема

Floor = 70 применяется одинаково для `elevated` и `high`. При base=71 и high concern:
- Номинал 8% × 71 = 5.7 → 6 pts
- Floor ограничивает до 71−70 = 1 pt
- Результат: high concern = moderate в числовом выражении (оба дают ≈0 pts для base 71)

Это нарушает семантику: high должен бить сильнее elevated, а по факту оба дают 0−1 pt при base ≈ 70.

### Рекомендация: differentiated floor

```
floorValue = concern === 'high' ? 67 : 70
if base >= floorValue:
    max_cut = base - floorValue
    pointsRemoved = min(pointsRemoved, max_cut)
```

Эффекты:
- **Elevated**: floor остаётся 70 → защита strong-core при мягком риске среды (Ozone Park, Lyubertsy не затронуты, у них base далеко от 70)
- **High**: floor 67 → позволяет Cannes сдвинуться с 71 на 67 вместо 71→70

**Риск**: если Cannes является false alarm (industrial OSM = марина/порт, nightlife = туристическое предложение), то 71→67 может быть слегка агрессивным для реального premium resort. Однако NE score 77 + 5 активных стрессоров + harshUrbanStack=0.5 — достаточно реальные сигналы для осторожного тона.

---

## Анализ confidence gating (текущий — оставить)

Текущая логика правильна:
- confidence=low → no penalty (нет данных достаточно хороших)
- confidence=medium → penalty × 2/3
- confidence=high → full penalty

Изменений не требуется. В контрольном наборе все resolved кейсы имеют confidence=high — это ожидаемо при достаточном OSM.

---

## Сравнительная таблица: current vs pass-2 candidates

Симуляция 4 режимов на контрольных кейсах с penalty:

| Кейс | Тип | Base | NE tier | **Current** | **Pass-2A** (6%/floor67) | **Pass-2B** (7%/floor65) | **Pass-2C** (8% elevated/floor67) |
|------|-----|------|---------|-------------|--------------------------|--------------------------|-----------------------------------|
| Ozone Park | false premium | 100 | elev/high | 95 (−5) | 94 (−6) | 93 (−7) | 92 (−8) |
| Lyubertsy | false suburb | 88 | elev/high | 84 (−4) | 83 (−5) | 82 (−6) | 81 (−7) |
| Sochi | moderate + resort | 65 | elev/high | 62 (−3) | 61 (−4) | 61 (−4) | 61 (−4)* |
| Cannes | resort/high NE | 71 | high/high | 70 (−1 floored) | **67 (−4, floor=67)** | **66 (−5, floor=65)** | 67 (−4) |
| Times Square | iconic CBD | 74 | moderate | 74 | 74 | 74 | 74 |
| Causeway Bay | strong CBD | 80 | moderate | 80 | 80 | 80 | 80 |
| Miami Brickell | strong CBD | 92 | moderate | 92 | 92 | 92 | 92 |
| Canary Wharf | strong CBD | 76 | moderate | 76 | 76 | 76 | 76 |
| Pechatniki | industrial/false | 89 | moderate | 89 | 89 | 89 | 89 |
| Sochi | honest viable | 65 | elev | 62 | 61 | 61 | 61 |
| Copacabana | resort/low | 79 | low | 79 | 79 | 79 | 79 |

_* Cap 9 pts применяется: 8%×65=5.2→5pts, floor не активен (65<67)._

**Pass-2A (6%/floor-67)** выбрана как наиболее правдоподобная:
- Даёт +1 pt reduction для elevated-кейсов (незначительный, но правильный шаг)
- Cannes: −1→−4 (ключевое улучшение, floor перестаёт блокировать high-tier)
- Никаких регрессий на honest-strong кейсах (все moderate без изменений)
- Не ломает Sochi (остаётся viable)
- Не уходит в опасную территорию (Pass-2B/C дают −5/−7/−8 на Ozone Park — уже на границе)

---

## Рекомендуемая pass-2 калибровка

### Nominal reduction fractions

```typescript
// src/lib/location/neighborhood-environment-commercial-modifier.ts
function nominalReductionFraction(
  concern: 'elevated' | 'high',
  neighborhoodConfidence: 'medium' | 'high',
): number {
  if (concern === 'elevated') {
    return neighborhoodConfidence === 'high' ? 0.06 : 0.04;  // было: 0.045 / 0.03
  }
  return neighborhoodConfidence === 'high' ? 0.08 : 0.07;    // было: 0.08 / 0.06
}
```

Изменения:
- `elevated` + high: 4.5% → **6.0%** (+1.5pp)
- `elevated` + medium: 3.0% → **4.0%** (+1pp, консистентность)
- `high` + high: 8.0% → **8.0%** (без изменений, floor даст эффект)
- `high` + medium: 6.0% → **7.0%** (+1pp, небольшое ужесточение)

### Headline floor rule

```typescript
// Differentiated floor by concern severity
const strongBandFloor = concern === 'high' ? 67 : 70;
if (base >= strongBandFloor) {
  const maxByStrongFloor = base - strongBandFloor;
  if (pointsRemoved > maxByStrongFloor) strongBandFloorApplied = true;
  pointsRemoved = Math.min(pointsRemoved, maxByStrongFloor);
}
```

### Rule for moderate
**Без изменений** — только текстовый слой. Причина: нет доступа к `evergreenIndex` в modifier-функции; любой числовой порог для moderate будет слепым относительно разрыва EV↔headline и ударит по честным CBD.

### Rule for elevated
6.0% (high confidence) / 4.0% (medium confidence). Floor = 70.

### Rule for high
8.0% (high confidence) / 7.0% (medium confidence). Floor = **67**.

### Confidence gating
Без изменений: confidence=low → no penalty.

---

## Какие кейсы улучшатся

| Кейс | Текущий headline | Pass-2 headline | Улучшение |
|------|-----------------|-----------------|-----------|
| **Cannes** | 70 (floor-blocked, −1) | **67 (−4)** | Главное улучшение: high tier перестаёт быть фиктивным. Narrows gap между `high` и `elevated`. |
| Ozone Park | 95 (−5) | 94 (−6) | Маргинально, но правильное направление. |
| Lyubertsy | 84 (−4) | 83 (−5) | Аналогично, +1 pt в сторону реализма. |
| Sochi center | 62 (−3) | 61 (−4) | Минимально, остаётся viable. |

---

## Какие риски остаются

### 1. Cannes — возможная aggressiveness
NE high для Cannes Croisette частично вызван:
- nightlife=1.0 (туристическое предложение, не помеха)
- industrial=0.37 (возможно OSM марина/порт у набережной — артефакт маппинга)
- transit=1.0 (реальная плотность, но для STR это позитив)

Если NE model overestimates concern для resort/waterfront типов, то 71→67 может быть чуть агрессивно для genuinely premium Croisette location. Митигация: без полевого feedback не устранить без domain-specific NE calibration.

### 2. Pechatniki остаётся false premium (base 89, EV 56)
Pass-2 не решает этот кейс — moderate без EV-gating слишком опасен. Нужен pass-3.

### 3. Lyubertsy остаётся "слишком оптимистичным" (83 → strong)
EV=96 — это driver проблемы, не NE modifier. Modifier не может компенсировать commercial model, которая переоценила пригород через транзитные магниты.

### 4. LIC (Long Island City) — нет контрольных данных
Таймаут в обоих прогонах. При полном OSM (EV=100, NE=78/high) правильное поведение: 8% от 95 = 7.6→8 pts → 87. С floor 67: нет ограничения (95-67=28). Pass-2 даёт 87 — реалистично для dense transit hub с high NE.

---

## Что внедрять следующим коммитом

**Scope: минимальный, только параметрические изменения в двух местах.**

### 1. `src/lib/location/neighborhood-environment-commercial-modifier.ts`

**Изменение A** — function `nominalReductionFraction`:
```typescript
// BEFORE
if (concern === 'elevated') {
  return neighborhoodConfidence === 'high' ? 0.045 : 0.03;
}
return neighborhoodConfidence === 'high' ? 0.08 : 0.06;

// AFTER
if (concern === 'elevated') {
  return neighborhoodConfidence === 'high' ? 0.06 : 0.04;
}
return neighborhoodConfidence === 'high' ? 0.08 : 0.07;
```

**Изменение B** — floor logic:
```typescript
// BEFORE
if (base >= 70) {
  const maxByStrongFloor = base - 70;
  if (pointsRemoved > maxByStrongFloor) strongBandFloorApplied = true;
  pointsRemoved = Math.min(pointsRemoved, maxByStrongFloor);
}

// AFTER
const strongBandFloor = concern === 'high' ? 67 : 70;
if (base >= strongBandFloor) {
  const maxByStrongFloor = base - strongBandFloor;
  if (pointsRemoved > maxByStrongFloor) strongBandFloorApplied = true;
  pointsRemoved = Math.min(pointsRemoved, maxByStrongFloor);
}
```

**Объяснения в explainEn/Ru:** добавить упоминание floor threshold при `strongBandFloorApplied`, чтобы было ясно, какой пол сработал.

### Не трогать в этом коммите
- `moderate` handling — оставить только текст
- `config.ts` — `maxPointReduction: 9` не меняется
- `minOsmElementsForPenalty: 10` не меняется
- Весь base commercial model / evergreen / magnets

---

## Pass-3 backlog (не в этом коммите)

- **EV-gated moderate penalty**: в modifier добавить `evergreenIndex` как input → только тогда moderate может давать −1..−2 pts при EV < base−20 AND confidence=high AND NE-friction ≥ 42. Это решит Pechatniki без ущерба для Times Square / Brickell.
- **Resort NE sub-model calibration**: ночные заведения и transit для resort-типов должны иметь меньший вес в friction score (они — demand driver, а не friction). Cannes, El Poblado, Times Square.
- **LIC retry**: при наличии полного OSM — контрольная проверка pass-2 behavior.

---

## Итоговые ответы

### 1. Какую новую калибровку ты рекомендуешь?

Pass-2A:
- `elevated`+high: **6%** (было 4.5%)
- `elevated`+medium: **4%** (было 3%)
- `high`+high: **8%** (без изменений)
- `high`+medium: **7%** (было 6%)
- Floor для `elevated`: **70** (без изменений)
- Floor для `high`: **67** (было 70 для всех) — главное изменение

### 2. Стоит ли moderate начать слегка штрафовать?

**Нет — в pass-2.** Без `evergreenIndex` в modifier-функции любой moderate penalty будет слепым. Он ударит по Brickell (92), Downtown Brooklyn (88) и Times Square (74) — честным сильным кейсам — так же, как по Pechatniki (89 при EV=56). Нужна EV-gating логика, это pass-3.

### 3. Нужно ли ослабить floor 70?

**Да — но только для `high` tier.** Для `elevated` floor=70 правильный: он защищает сильные demand cores при мягком риске среды. Для `high` tier floor=70 фактически сводит к нулю penalty для base=71…74, делая `high` эквивалентным `moderate` численно. Новый floor=67 для `high` даёт Cannes −4 pts вместо −1 pt — разница хорошо читаема.

### 4. Даст ли это заметный шаг вперёд по правдоподобности?

**Да, точечно заметный.** На контрольном наборе:
- Cannes: главный выигрыш — high tier наконец работает числово (71→67 вместо 71→70).
- Elevated кейсы: +1 pt каждый — маргинальное, но правильное направление.
- Moderate кейсы: без изменений (правильно).
- Честные strong cores не сломаны.

Фундаментальные проблемы (Pechatniki, Lyubertsy «слишком оптимистично» из-за EV) pass-2 не закрывает — они в commercial model и EV-calibration, которую трогать нельзя. Для этих кейсов pass-2 — шаг к правдоподобности, но не полное решение.
