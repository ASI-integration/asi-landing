# Location Commercial — Existing Assets Audit

_Дата аудита: 2026-04-18. Цель: инвентаризация всего существующего, без новых концепций._

---

## 1. Уже существующие страницы (live routes)

| URL | Файл | Статус | Что показывает |
|---|---|---|---|
| `/features/location-analysis` | `src/app/features/location-analysis/page.tsx` | ✅ Live, EN | LocationIntelligenceDemo с вводом адреса, OSM analysis, heatmap |
| `/ru/location-analysis` | `src/app/ru/location-analysis/page.tsx` | ✅ Live, RU | То же, ru locale, с объясняющим блоком про доходность |
| `/ru/location-report/[reportId]` | `src/app/ru/location-report/[reportId]/page.tsx` | ✅ Live | Полный отчёт по permalink: summary, business_fit, magnets, competition, income_strategy |
| `/ru/location-report` | `src/app/ru/location-report/page.tsx` | ✅ Live (empty state) | Редирект-заглушка: "запустите анализ заново" |
| `/ru/kak-my-ocenivaem-dohodnost-obektov` | `src/app/ru/kak-my-ocenivaem-dohodnost-obektov/page.tsx` | ✅ Live | Методологическая страница: как оцениваем, ADR, OCC, RevPAR |
| `/ru/otchet-po-dohodnosti-obektov` | `src/app/ru/otchet-po-dohodnosti-obektov/page.tsx` | ✅ Live | Лендинг продукта "Отчёт по доходности" |

**Вывод:** 4 полноценные location-страницы уже работают. Ни одна из них не позиционирована как "commercial / retail". Все 4 заточены под жилую/rental аудиторию.

---

## 2. Уже существующие компоненты

| Компонент | Файл | Статус | Описание |
|---|---|---|---|
| `LocationIntelligenceDemo` | `src/components/LocationIntelligenceDemo.tsx` | ✅ Production | Основной компонент: ввод адреса, OSM анализ, heatmap, score, magnets, foot traffic, конкуренты, neighborhood |
| `LocationStandaloneFullReport` | `src/components/location/LocationStandaloneFullReport.tsx` | ✅ Production | Полный отчёт с 6 секциями: summary / business_fit / magnets / competition / income_strategy / next_step |
| `location-intelligence-locale.tsx` | `src/components/location-intelligence-locale.tsx` | ✅ Production | Локализация: `LOC_COPY[en/ru]`, foot traffic labels, magnet labels |

**Что в `LocationStandaloneFullReport` уже построено (все 6 секций):**
- **Summary**: вердикт + 3 драйвера + доход/мес + рекомендуемая стратегия
- **Business-fit**: подходит / не подходит + primary magnets с дистанциями
- **Magnets**: primary + secondary список с категориями
- **Competition**: счётчик конкурентов + pressure level (low/medium/high)
- **Income/Strategy**: 3 стратегии (short/hybrid/mid) с рублёвыми цифрами + positioning hint
- **Next step**: CTA блок с ссылкой на `/connect`

---

## 3. Уже существующая backend-логика / API

| Route | Файл | Метод | Что делает |
|---|---|---|---|
| `/api/location-demo-analyze` | `src/app/api/location-demo-analyze/route.ts` | POST `{lat, lon}` | OSM fetch через Overpass → `buildAnalysis()` → cache → возвращает полный `LocationAnalysis` |
| `/api/location-standalone-report` | `src/app/api/location-standalone-report/route.ts` | POST `{locale, report}` | Сохраняет `LocationStandaloneReport` в Supabase → возвращает `{reportId}` |
| `/api/location-standalone-report/[reportId]` | `src/app/api/location-standalone-report/[reportId]/route.ts` | GET | Возвращает сохранённый отчёт по ID |
| `/api/address-suggest` | `src/app/api/address-suggest/route.ts` | GET `?q=...&locale=...` | Саджесты адресов (2GIS / Google / Photon / DaData) |
| `/api/location-geocode` | `src/app/api/location-geocode/route.ts` | POST | Геокодинг адреса → lat/lon |
| `/api/location-analyze` | `src/app/api/location-analyze/route.ts` | POST | Прокси на ASI-automation-core (другой сервис, не OSM путь) |
| `/api/location-competitors` | `src/app/api/location-competitors/route.ts` | POST | Конкуренты рядом (STR) |

---

## 4. Существующая engine-логика, прямо применимая для commercial режима

### 4.1 Foot traffic — структура потока (ЕСТЬ, не выведена на фронт как commercial)

**Файл:** `src/lib/location/foot-traffic.ts`

`FootTrafficSummary.transitVsTarget`:
```ts
{
  transitShare:      number;  // 0–1 доля транзитного потока
  localActiveShare:  number;  // 0–1 доля локального / neighbourhood потока
  destinationShare:  number;  // 0–1 доля целевого потока (едут специально)
}
```

Функция `magnetFlowWeights(m: MagnetItem)` уже кодирует **commercial intent** по категориям:
- `metro/airport/railway_station` → transit-heavy (45–65% transit)
- `hospital/convention/major_hotel` → destination-led (65–80% destination)
- `shopping_major/attraction/university` → destination (85%)
- `food/shopping_local/education_local` → local active (68%)
- `business` → mixed (52% local, 30% destination)

**Это уже commercial flow intelligence.** Не обёрнуто как продукт.

### 4.2 Demand type (ЕСТЬ, вычисляется в buildAnalysis)

`DemandType`: `'tourism-led' | 'business-led' | 'transport-led' | 'mixed'`

Уже показывается в telemetry/debug, но не центральный UI-элемент. Для commercial — это ключевой сигнал.

### 4.3 Neighborhood environment — барьеры (ЕСТЬ, не показывается как spatial barrier)

**Файл:** `src/lib/location/neighborhood-environment.ts`

`NeighborhoodEnvironmentLayer.breakdown`:
```ts
{
  majorRoads01:        number;  // дороги-разделители (motorway/trunk/primary)
  industrial01:        number;  // промзоны рядом
  aviation01:          number;  // аэродромы/взлётные полосы
  nightlife01:         number;  // ночная жизнь (шум)
  transitCorridor01:   number;  // транзитные коридоры
  harshUrbanStack01:   number;  // комбинированный стресс среды
}
```

Это **пространственные барьеры и фрикция** — именно то, что нужно commercial анализу. Сейчас показывается только как livability concern.

### 4.4 Audience analysis (ЕСТЬ, показывается в residential контексте)

**Файл:** `src/lib/location/audience-scoring.ts`

- `AudienceAnalysis.audienceSharePct` — % business vs tourist в потоке (0–100)
- `AudienceAnalysis.locationType` — `'URBAN_BUSINESS' | 'TOURIST_CLUSTER' | 'MIXED'`
- `businessClusterDetected` — есть ли кластер деловых объектов в 1 км

Это **commercial viability signal** — но сейчас интерпретируется исключительно как rental audience fit.

### 4.5 Magnet категории — уже достаточны для format fit inference

Из `config.ts` — категории с весами, которые перекрываются с commercial:
- `shopping_major` (weight 5) — retail catchment
- `food` (weight 1) — F&B density
- `business` (weight 5.5) — office / factory / commercial / bank (с sub-types)
- `education_local` (weight 1.5) — local residential indicator
- `shopping_local` (weight 1.2) — convenience indicator
- `entertainment` (weight 5) — evening/leisure flow
- `convention` (weight 6) — event/corporate destination

### 4.6 Heatmap (ЕСТЬ, работает)

`HeatmapPoint[]` с `intensity` и `categoryId` — SVG/canvas визуализация уже есть в `LocationIntelligenceDemo`. Intensity rings по радиусам — не реализованы, но данные для них есть.

---

## 5. Что существует, но не выведено на фронт

| Сигнал / компонент | Где лежит | Что нужно сделать |
|---|---|---|
| `transitVsTarget` split | `foot-traffic.ts` → `FootTrafficSummary` | Вывести в UI как блок "Структура потока" вместо просто `flowCharacter` |
| `demandType` ('transport-led') | `types.ts`, `gravity-scoring.ts` | Поднять как primary commercial signal, не только telemetry |
| `neighborhoodEnvironment.breakdown` | `neighborhood-environment.ts` | Переосмыслить как "Барьеры и friction" для commercial страницы |
| `audienceSharePct` | `audience-scoring.ts` | Показать как "business flow %" для commercial |
| `locationType` (URBAN_BUSINESS) | `audience-scoring.ts` | Использовать как commercial zone classification |
| `buildAnalysis()` full output | `gravity-scoring.ts` | Весь `LocationAnalysis` доступен — нужна только коммерческая интерпретация |
| `scoring.ts` (`analyzeAddress`, `scoreAddress`) | `src/lib/location/scoring.ts` | **Мёртвый код** — старая симулированная версия на hash+LCG. Не используется нигде в current app. Можно удалить или игнорировать. |

---

## 6. Что существует частично (нужно докрутить)

| Компонент | Что есть | Чего не хватает | Оценка работы |
|---|---|---|---|
| Format fit scoring | Все сигналы (magnetFlowWeights, audienceSharePct, demandType) | Функция `buildCommercialFormatFit()` — производит verdict (retail/food/service/etc.) из существующих сигналов | ~3–4 часа |
| Commercial report structure | `LocationStandaloneReport` с residential секциями | Новый тип `CommercialLocationReport` с flow / format_fit / barriers секциями вместо income_strategy | ~4–6 часов |
| Commercial page | `/ru/location-analysis` уже работает | Убрать residential CTA/дохода, добавить commercial форматный интерфейс | ~2–3 часа |
| Mode selector | Нет | Простой split на входе: "Жилая / Коммерческая" | ~1–2 часа |
| Flow visualization | Heatmap SVG есть | Intensity rings (50/100/250/500 м) поверх существующего heatmap | ~3–4 часа |

---

## 7. Что реально отсутствует (нужно построить с нуля)

| Компонент | Описание | Оценка |
|---|---|---|
| `buildCommercialFormatFit()` | Функция → `{retail_fit, food_fit, service_fit, convenience_fit, destination_fit}` каждый с verdict + reason | 3–5 ч |
| `CommercialLocationReport` type | Структура отчёта без income/strategy, с flow + format_fit + barriers | 2–3 ч |
| `buildCommercialStandaloneReport()` | Builder по аналогии с `buildLocationStandaloneReport()` | 3–4 ч |
| `LocationCommercialFullReport` component | UI для коммерческого отчёта (по аналогии с `LocationStandaloneFullReport`) | 4–6 ч |
| `/ru/location-analysis/commercial` или `?mode=commercial` | Отдельный путь для commercial режима | 1–2 ч |
| Mode selector UI на `/ru/location-analysis` | Residential / Commercial toggle | 1–2 ч |
| Intensity rings на heatmap | UI-only, данные есть | 2–3 ч |

**Итого absent: ~16–25 часов работы.** Это не "с нуля" — это надстройка над working engine.

---

## 8. Неожиданные находки

### 8.1 `scoring.ts` — это мёртвый код

`src/lib/location/scoring.ts` использует `simpleHash()` + LCG для детерминированных псевдо-scores. Это старая версия движка ДО подключения OSM/Overpass. Сейчас **не используется** ни одной страницей, ни одним API роутом. Это не commercial scoring — это артефакт v0. Можно удалить безопасно.

### 8.2 Вся pipeline уже end-to-end работает

```
User types address
→ /api/address-suggest (2GIS/Google/Photon)
→ User selects → lat/lon resolved
→ POST /api/location-demo-analyze
  → fetchOsmData(lat, lon) — OSM Overpass
  → buildAnalysis(elements, lat, lon) — gravity + foot-traffic + audience + neighborhood
  → cache (Supabase)
→ LocationIntelligenceDemo renders full LocationAnalysis
→ User clicks "Открыть отчёт"
→ buildLocationStandaloneReport(analysis) — structured report
→ POST /api/location-standalone-report → reportId
→ /ru/location-report/[reportId] — LocationStandaloneFullReport renders
```

**Commercial нужно только вставить новую ветку в конец этой pipeline.** Backend ничего менять не нужно.

### 8.3 `FootTrafficSummary.flowCharacter` уже описывает commercial flow

`'destination-led footfall'` vs `'mixed destination and transit'` vs `'transit-heavy footfall'` — это уже готовые commercial flow labels. Они показываются в `LocationIntelligenceDemo`, но в residential контексте.

---

_Связан с `location-standalone-product-spec.md` и `location-commercial-front-extraction-plan.md`._
