# Commercial Format-Fit — V1 Tuning Plan
**Дата:** 2026-04-19  
**Цель:** Переход от «патч-баг-за-багом» к аккуратному V1-level refinement  
**Основа:** Анализ `src/lib/location/commercial-format-fit.ts` + `docs/commercial-v1-expanded-validation.md`  
**Принцип:** Не ломать то, что работает. Каждое изменение — минимальная прицельная правка с явным обоснованием.

---

## 0. Сводка: что уже работает — не трогаем

| Формат | Что надёжно | Не трогать |
|--------|-------------|-----------|
| Retail HIGH | `idx>=60 + dest>=0.40 + (shopping/business/transit) + !industrial` | Пороги ок |
| F&B HIGH | `idx>=55 + flowScore>=2 + (business/transit) + !industrial` | Пороги ок |
| Service HIGH | `idx>=50 + (localActive>=0.30 OR business-led) + !industrial` | localActive guard — проблема (см. fix 1) |
| Convenience HIGH | `(hasTransit OR hasGoodFlow) + !touristCap + !industrial` | Core ок, tourist gate ок |
| Showroom HIGH | `!touristDominant + !isTransitHub + idx>=55 + dest>=0.45 + hasAccess + (business-led/cluster)` | Ок |
| Destination HIGH | `idx>=68 + dest>=0.50 + hasMajorAnchor + cluster` | Порог idx≥68 слишком жёсткий |

---

## 1. TOP-7 правок (наибольший эффект / минимальный риск)

---

### Fix 1 (ПРИОРИТЕТ: КРИТИЧНЫЙ) — `scoreService`: исключить чисто residential localActive

**Проблема:**  
`localActiveShare >= 0.30` — единственный guard для service=HIGH наряду с `dt === 'business-led'`.  
В жилых районах (Покровское-Стрешнево, Бутово) high local flow → service=HIGH — **ложно**.  
Сервис (барбершоп, химчистка) требует не просто «много людей», а регулярную аудиторию с  
достаточным доходом и деловую или business-context.

**Текущий код:**
```typescript
if (
  idx >= 50 &&
  (hasResidentialContext || dt === 'business-led') &&
  !industrial
) { fitLevel = 'high'; }
```

**Правка:**
```typescript
// hasResidentialContext (localActive>=0.30) alone is not enough for service=HIGH.
// Residential populations support service but need either business proximity
// or high-density mixed context (not pure sleep-zone).
const hasBusinessProximity = hasMagnetCategory(a, 'business', 'university', 'convention');
const serviceHighEligible =
  dt === 'business-led' ||
  (hasResidentialContext && hasBusinessProximity) ||
  (hasResidentialContext && idx >= 65 && a.gravityExplanation.clusterDetected);

if (idx >= 50 && serviceHighEligible && !industrial) {
  fitLevel = 'high';
}
```

**Эффект:**
- Покровское-Стрешнево: service HIGH → MEDIUM ✅
- Бутово: service HIGH → MEDIUM ✅
- Москва-Сити, Canary Wharf: service HIGH сохраняется (dt=business-led) ✅
- Бауманская (university рядом + residential): service HIGH сохраняется ✅

**Риск:** Низкий — уточняем, не убираем

---

### Fix 2 (ПРИОРИТЕТ: ВЫСОКИЙ) — `scoreDestinationVenue`: снизить HIGH порог

**Проблема:**  
`idx >= 68 && destinationShare >= 0.50 && (hasMajorAnchor || cluster)` — слишком жёсткий.  
Камден-Маркет, Монмартр, Gorky Park (если пройдёт industrial) — destination-места мирового класса  
которые могут не добраться до idx=68 или dest=0.50 из-за смешанного потока.

**Правка:**
```typescript
if (
  idx >= 60 &&                   // снижаем с 68 → 60
  destinationShare >= 0.44 &&    // снижаем с 0.50 → 0.44
  (hasMajorAnchor || cluster) &&
  !industrial
) {
  fitLevel = 'high';
  // ... supporting factors
```

**Эффект:**
- Camden Market (idx~90, dest~0.46): dest HIGH ✅
- Montmartre (idx~90, dest~0.48): dest HIGH ✅  
- Gorky Park: если industrial пройдёт, dest HIGH ✅
- Слабые жилые точки (idx~40, dest~0.20): не затронуты ✅

**Риск:** Низкий — расширяем HIGH вниз, не меняем MEDIUM/LOW

---

### Fix 3 (ПРИОРИТЕТ: ВЫСОКИЙ) — `scoreShowroom`: B2B-override для premium business streets with attractions

**Проблема:**  
5th Avenue, Via Montenapoleone Milan, Kurfürstendamm Berlin — улицы с attractions < 350 м,  
но с явным бизнес-контекстом. `touristDominant` блокирует showroom HIGH/MEDIUM.  
Это неверно: на 5th Ave есть флагманские магазины + B2B showrooms.

**Правка:**
```typescript
// touristDominant OVERRIDE: if the location is explicitly business-led
// with a very strong overall index, allow showroom even near tourist attractions.
// This covers premium shopping streets where tourists and B2B coexist.
const touristDominant =
  hasTouristAnchor &&
  destinationShare >= 0.50 &&
  dt !== 'business-led' &&
  !(dt === 'mixed' && hasBusinessCluster && idx >= 80); // NEW: dense urban B2B override
```

**Эффект:**
- 5th Ave (dt=mixed, cluster=true, idx=100, dest=0.55): showroom MEDIUM (не LOW) ✅
- Red Square (dt=tourism-led, cluster=false): showroom LOW (не изменяется) ✅
- Covent Garden (dt=tourism-led): showroom LOW (не изменяется) ✅

**Риск:** Средний — тестировать на tourist-dominant точках без B2B

---

### Fix 4 (ПРИОРИТЕТ: СРЕДНИЙ) — `scoreRetail`: усилить HIGH для iconic high-streets

**Проблема:**  
Арбат, Тверская, Nevsky (после фикса industrial) могут оставаться retail=MEDIUM  
если `destinationShare >= 0.40` не достигается из-за смешанного потока.  
На iconic pedestrian retail streets с высоким EV и tourist anchor retail должен быть HIGH.

**Правка:**
```typescript
// Additional HIGH path: strong tourist-pedestrian retail context
// (iconic shopping streets — Arbat, Nevsky, Carnaby — that may miss dest>=0.40
// because tourist+local flow splits the destinationShare)
const isTouristRetailStreet =
  hasMagnetCategory(a, 'attraction') &&
  dt === 'tourism-led' &&
  idx >= 65 &&
  !hasTransit; // transit-heavy tourist points (stations) don't qualify

if (
  idx >= 60 &&
  (destinationShare >= 0.40 && (hasShoppingAnchor || hasBusinessCluster || hasTransit)) ||
  (isTouristRetailStreet && hasShoppingAnchor) &&
  !industrial
) {
  fitLevel = 'high';
```

**Риск:** Средний — проверить что isTouristRetailStreet не даёт HIGH в жилых tourist-adjacent районах

---

### Fix 5 (ПРИОРИТЕТ: СРЕДНИЙ) — `industrialBarrier`: soft-pass для recreational parks

**Проблема:**  
Gorky Park, Hyde Park — имеют high industrial01 из-за прилегающей инфраструктуры,  
но сами являются destination-местами с реальным коммерческим потенциалом (кафе, ивенты).

**Правка:**
```typescript
// Recreational parks: high-attraction, not-business-industrial context
// If attraction is the dominant magnet and index is strong, soften the barrier.
const hasAttractionAnchorClose = nearMagnets(a, 600, 'attraction');
const isRecreationalPark =
  hasAttractionAnchorClose &&
  dt !== 'business-led' &&
  dt !== 'transport-led' &&
  (analysis.footTraffic.transitVsTarget.destinationShare >= 0.40);

if (ind <= 0.85 && isRecreationalPark && analysis.evergreenIndex >= 55) return false;
```

**Эффект:**
- Gorky Park (ind=0.70, attraction=Gorky Park itself, dest>0.40): barrier=false ✅
- True industrial zones (ind=0.90+): не затронуты ✅

**Риск:** Средний — тестировать edge cases (промзоны рядом с парками)

---

### Fix 6 (ПРИОРИТЕТ: НИЗКИЙ) — `scoreFoodBeverage`: явный tourist F&B сигнал

**Проблема:**  
F&B на туристических улицах должен быть HIGH — не из-за business-anchor, а из-за tourist flow.  
Сейчас `hasBusinessOrUniv` не включает attraction, поэтому tourist destinations при отсутствии  
business magnet могут получить F&B только MEDIUM.

**Правка:**
```typescript
// F&B is viable even in pure tourist contexts (cafés, souvenir food, restaurants)
const hasTouristFoodContext =
  hasMagnetCategory(a, 'attraction', 'entertainment', 'stadium') &&
  dt === 'tourism-led';

const hasBusinessOrUnivOrTourist =
  hasMagnetCategory(a, 'business', 'university', 'shopping_major', 'entertainment') ||
  hasTouristFoodContext;

if (idx >= 55 && flowScore >= 2 && hasBusinessOrUnivOrTourist && !industrial) {
  fitLevel = 'high';
```

**Эффект:**
- Montmartre, Camden Market (pure tourist): F&B HIGH ✅
- Деловые кварталы без tourist: F&B HIGH сохраняется ✅

**Риск:** Низкий

---

### Fix 7 (ПРИОРИТЕТ: НИЗКИЙ) — улучшить `explanation` для low/medium кейсов

**Проблема:**  
Объяснения в `explanationRu` при `fitLevel='low'` и `'medium'` часто слишком общие.  
Нет разницы между «слабый вообще» и «слабый именно для этого формата».

**Правка (only copy changes, no logic):**  
Пересмотреть объяснения для каждого формата при low/medium:
- Добавить конкретный limiting factor в объяснение
- Упомянуть главный барьер (transit vs. industrial vs. absent anchor)

**Риск:** Нулевой (только copy)

---

## 2. Таблица приоритетов

| # | Fix | Форматы | Приоритет | Риск | Эффект |
|---|-----|---------|-----------|------|--------|
| 1 | Service: residential guard | service | КРИТИЧНЫЙ | Низкий | Устраняет ложные HIGH |
| 2 | Destination: снизить HIGH порог | destination_venue | ВЫСОКИЙ | Низкий | Больше правильных HIGH |
| 3 | Showroom: B2B override при attractions | showroom | ВЫСОКИЙ | Средний | 5th Ave, KuDamm |
| 4 | Retail: tourist retail HIGH path | retail | СРЕДНИЙ | Средний | Arbat, Nevsky |
| 5 | Industrial: recreational park soft-pass | все форматы | СРЕДНИЙ | Средний | Gorky Park |
| 6 | F&B: tourist food context | food_beverage | НИЗКИЙ | Низкий | Montmartre |
| 7 | Explanation copy | все форматы | НИЗКИЙ | Нулевой | UX |

---

## 3. Правила — оставить без изменений

| Правило | Причина сохранить |
|---------|-------------------|
| `industrialBarrier(ind > 0.85)` | Работает верно для true industrial |
| `touristDominant` + `nearMagnets(350)` | Верный результат после Fix 2 |
| `isTransitHub` guard в showroom | Правильно блокирует transit stations |
| `touristCap` в convenience + `railwayIsTransitContext` | Верно решает tourist vs. transit |
| Showroom HIGH требует `dt=business-led OR hasBusinessCluster` | Принципиальный guard |
| Retail HIGH требует `idx >= 60` | Нижний предел качества |

---

## 4. Пороги — пересобрать

| Параметр | Текущий | Рекомендованный | Обоснование |
|----------|---------|-----------------|-------------|
| Destination HIGH idx | `>= 68` | `>= 60` | Слишком жёсткий — исключает средние destination spots |
| Destination HIGH dest | `>= 0.50` | `>= 0.44` | 0.50 не достигается на mixed tourist+local destinations |
| Service HIGH guard | localActive only | localActive + business proximity | Устранение ложных HIGH |
| Retail HIGH path | только без tourist | + tourist retail street | Arbat, Nevsky паттерн |

---

## 5. Сигналы — усилить

| Сигнал | Как усилить | Эффект |
|--------|-------------|--------|
| Tourist retail context | Добавить отдельный HIGH path в retail для tourist-led + shopping anchor | Arbat, Carnaby HIGH |
| Business proximity для service | Добавить в HIGH condition | Точнее service в смешанных районах |
| Attraction-anchor для F&B | Добавить в hasBusinessOrUniv | Tourist destinations → F&B HIGH |
| B2B in tourist zone | Override в showroom для dt=mixed + cluster + idx≥80 | 5th Ave patten |

---

## 6. Сигналы — ослабить

| Сигнал | Как ослабить | Риск |
|--------|-------------|------|
| `localActiveShare >= 0.30` как service HIGH trigger | Добавить условие business proximity | Средний (нужны тесты) |
| `industrial01` в 0.50–0.85 зоне | Расширить escape hatch на recreational parks | Средний |
| `hasMajorAnchor` как единственный HIGH trigger для destination | Уже есть `cluster` как альтернатива — ок | — |

---

## 7. Изменения, требующие осторожного контроля

1. **Fix 3 (Showroom B2B override)** — нужно проверить, что не даёт showroom HIGH на Красной площади, Arbat, Covent Garden  
2. **Fix 4 (Tourist retail HIGH)** — нужно проверить что не даёт HIGH в жилых районах с одной достопримечательностью  
3. **Fix 5 (Recreational park)** — нужно убедиться что true industrial + adjacent park не проходит  

---

## 8. Порядок внедрения (безопасный)

```
Pass 3:
1. Fix 1 — service guard (критичный, низкий риск)
2. Fix 2 — destination threshold (высокий приоритет, низкий риск)
3. Fix 6 — F&B tourist (низкий риск)

Pass 4 (отдельный, с тестами):
4. Fix 3 — showroom B2B override
5. Fix 4 — retail tourist path
6. Fix 5 — industrial recreational park

Pass 5:
7. Fix 7 — объяснения (копирайт)
```

---

*Следующий шаг: `docs/commercial-micro-catchment-spec.md`*
