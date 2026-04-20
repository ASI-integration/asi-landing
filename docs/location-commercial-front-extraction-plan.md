# Location Commercial — Front Extraction Plan

_Дата: 2026-04-18. Цель: вывести commercial branch на фронт используя то, что уже есть._

---

## Принцип

Не строить новый продукт. Вывести наружу то, что уже вычисляется, но не показывается как commercial. Три уровня действий:
1. **Redirect + relabel** — сменить тексты и роутинг без изменения кода.
2. **Wire-up** — подключить существующие данные к новому UI.
3. **New function** — только то, чего реально нет (format fit scorer).

---

## Шаг 1 — Mode selector на `/ru/location-analysis` (1–2 часа)

**Файл:** `src/app/ru/location-analysis/page.tsx`

**Что делаем:** Добавить query param `?mode=commercial` и показывать разный вводный блок в зависимости от режима. Сам `LocationIntelligenceDemo` не трогаем.

```tsx
// page.tsx
const mode = searchParams.get('mode') ?? 'residential';

// Hero section меняет тексты:
// mode='residential' → "Доходность начинается с локации"  (текущий)
// mode='commercial'  → "Пространственный анализ локации для бизнеса"
```

**Что пользователь видит сейчас:** одна страница без выбора.  
**Что пользователь увидит:** два пути — жилая/коммерческая.

**Entry point URL:**
- Residential: `/ru/location-analysis` (без изменений)
- Commercial: `/ru/location-analysis?mode=commercial`

---

## Шаг 2 — Вывести flow structure из `FootTrafficSummary` (2–3 часа)

**Файл:** `src/components/LocationIntelligenceDemo.tsx`

**Что уже есть в данных:**
```ts
analysis.footTraffic.transitVsTarget = {
  transitShare:      0.32,  // 32% поток транзитный
  localActiveShare:  0.28,  // 28% локальный
  destinationShare:  0.40,  // 40% целевой (едут специально)
}
analysis.footTraffic.flowCharacter // 'destination-led footfall'
analysis.footTraffic.modifierTier  // 'strong' | 'moderate' | 'weak'
analysis.demandType               // 'business-led' | 'transport-led' | 'tourism-led' | 'mixed'
```

**Что нужно:** Добавить в UI блок "Структура потока" с тремя bar-сегментами и лейблами. Показывать только в `mode=commercial`. Данные уже есть — нужен только новый UI-блок.

```tsx
// Новый компонент FlowStructureBlock (или раздел в LocationIntelligenceDemo)
// Показывает три сегмента:
// Транзитный поток: 32%
// Локальный поток:  28%
// Целевой поток:    40%
// + итоговый label: "преобладает целевой поток"
```

---

## Шаг 3 — Format fit scoring function (3–5 часов)

**Новый файл:** `src/lib/location/commercial-format-fit.ts`

**Что это:** Функция, которая берёт существующий `LocationAnalysis` и выдаёт оценку пригодности под 5 форматов. Все входные данные уже есть.

```ts
export type CommercialFormatFitLevel = 'strong' | 'moderate' | 'weak' | 'unclear';

export interface CommercialFormatFitResult {
  retail:       { level: CommercialFormatFitLevel; reason: string };
  food:         { level: CommercialFormatFitLevel; reason: string };
  service:      { level: CommercialFormatFitLevel; reason: string };
  convenience:  { level: CommercialFormatFitLevel; reason: string };
  destination:  { level: CommercialFormatFitLevel; reason: string };
}

export function buildCommercialFormatFit(analysis: LocationAnalysis): CommercialFormatFitResult
```

**Алгоритм (всё из существующих полей):**

```
retail:
  strong   if: shopping_major nearby + destinationShare > 0.35 + competitor pressure < high
  moderate if: shopping_major OR food cluster nearby + destinationShare > 0.25
  weak     otherwise

food:
  strong   if: food magnet cluster (≥5 in 220m) OR entertainment/convention nearby + destinationShare > 0.3
  moderate if: food magnets nearby + localActiveShare > 0.25
  weak     otherwise

service:
  strong   if: business magnets nearby (office/commercial) + localActiveShare > 0.3
  moderate if: business OR education_local nearby
  weak     otherwise

convenience:
  strong   if: education_local + shopping_local + high localActiveShare
  moderate if: any local magnets + low competitor pressure
  weak     if: primarily transit or tourist zone

destination:
  strong   if: attraction/convention/entertainment OR locationType = URBAN_BUSINESS + high destinationShare
  moderate if: city-scale magnets (hospital/university/stadium) + stable flow
  weak     otherwise
```

Все значения (`shopping_major`, `food`, `education_local`, `localActiveShare`, `destinationShare`, `locationType`) берутся из `LocationAnalysis` без дополнительных запросов.

---

## Шаг 4 — Commercial report structure (3–4 часа)

**Новый файл:** `src/lib/location/commercial-report.ts`

По аналогии с `standalone-report.ts`, но без `income_strategy`. Новые секции:

```ts
export type CommercialLocationReport = {
  version: 'commercial-v1';
  address: string;
  generated_at_iso: string;
  sections: [
    { id: 'flow_structure'; ... },   // transitVsTarget + demandType + flowCharacter
    { id: 'format_fit'; ... },       // CommercialFormatFitResult
    { id: 'magnets_commercial'; ... }, // magnets с commercial-релевантными категориями
    { id: 'barriers'; ... },         // neighborhoodEnvironment.breakdown (барьеры)
    { id: 'competition_commercial'; ... }, // competitor count + pressure
    { id: 'commercial_verdict'; ... }, // итоговый вывод
  ]
}

export function buildCommercialLocationReport(args: {
  address: string;
  analysis: LocationAnalysis;
}): CommercialLocationReport
```

Все данные берутся из одного `LocationAnalysis` — нового API вызова не нужно.

---

## Шаг 5 — Commercial report UI component (4–6 часов)

**Новый файл:** `src/components/location/LocationCommercialFullReport.tsx`

По аналогии с `LocationStandaloneFullReport.tsx` (уже 525 строк — хороший шаблон).

Секции UI:
1. **Hero**: адрес + demandType label + commercial zone verdict
2. **Структура потока**: три бара (transit/local/destination) + flowCharacter
3. **Пригодность под формат**: 5 карточек (retail/food/service/convenience/destination) с level badge
4. **Ключевые магниты**: список с акцентом на commercial-категориях (shopping/food/business/entertainment)
5. **Барьеры**: дороги/промзоны — из `neighborhoodEnvironment.breakdown`
6. **Конкуренция**: аналогично residential (competitor count + pressure)
7. **Итоговый вывод**: формульный вывод под выбранный формат + CTA

---

## Шаг 6 — Подключить commercial path к permalink (1–2 часа)

**Файл:** `src/app/api/location-standalone-report/route.ts`

Уже принимает `{ locale, report }`. Нужно расширить на:
```ts
{ locale: 'ru' | 'en'; report: LocationStandaloneReport | CommercialLocationReport }
```

**Новый роут:** `/ru/location-report/[reportId]` — уже существует и рендерит `LocationStandaloneFullReport`. Добавить ветку:
```ts
if (isCommercialLocationReportV1(entity.report)) {
  return <LocationCommercialFullReport report={entity.report} />;
}
```

---

## Приоритизированные задачи — самый быстрый visible result

### Задача 1: Mode selector (1–2 ч) → **Немедленный visible result**

Добавить на `/ru/location-analysis` toggle / split screen "Жилая / Коммерческая" с разными текстами. Пользователь уже видит два режима. Под капотом — тот же движок.

**Файл:** `src/app/ru/location-analysis/page.tsx`  
**Изменение:** читать `searchParams.mode`, показывать другой H1/описание/CTA в зависимости от режима.

---

### Задача 2: Flow structure block в демо (2–3 ч) → **Immediate commercial signal**

Добавить в `LocationIntelligenceDemo` блок "Структура потока" (три сегмента `transitVsTarget`) при `mode=commercial`. Данные уже есть — только UI.

**Файл:** `src/components/LocationIntelligenceDemo.tsx`  
**Изменение:** условный блок, показывающий flow structure только когда `mode='commercial'`.

---

### Задача 3: `buildCommercialFormatFit()` (3–5 ч) → **Core commercial value**

Единственная новая логика. Без неё commercial режим не имеет ключевой ценности. После написания — сразу показывать в demo и в отчёте.

**Новый файл:** `src/lib/location/commercial-format-fit.ts`

---

### Задача 4: `CommercialLocationReport` + `buildCommercialLocationReport()` (3–4 ч) → **Persist and share**

Построить report structure по аналогии с residential. После этого можно сохранять коммерческий анализ в Supabase и давать permalink.

**Новый файл:** `src/lib/location/commercial-report.ts`

---

### Задача 5: `LocationCommercialFullReport` component (4–6 ч) → **Shareable commercial product**

UI отчёта. После этого пользователь может поделиться анализом локации с партнёром/арендодателем — как готовый коммерческий документ.

**Новый файл:** `src/components/location/LocationCommercialFullReport.tsx`

---

## Что можно показать пользователю в ближайшей итерации

### После задач 1+2 (3–5 часов):

Пользователь заходит на `/ru/location-analysis?mode=commercial`, вводит адрес коммерческого помещения, получает:
- Структуру потока: транзитный / локальный / целевой (%)
- Тип спроса: деловой / туристический / транзитный / смешанный
- Магниты в категориях (shopping, food, business, entertainment)
- Конкурентное давление
- Heatmap
- Neighborhood barriers (дороги/промзоны)

Это уже достаточно для первых коммерческих users.

### После задач 1+2+3+4+5 (15–20 часов):

Полный коммерческий путь:
1. `/ru/location-analysis?mode=commercial` → ввод адреса
2. Анализ → показывает flow structure + format fit grid (retail/food/service/...)
3. "Открыть отчёт" → сохраняет `CommercialLocationReport` в Supabase
4. Permalink `/ru/location-report/[reportId]` → `LocationCommercialFullReport`
5. Пользователь делится ссылкой с партнёром/арендодателем

---

## Что НЕ нужно делать для этого MVP

- **Не трогать** `gravity-scoring.ts`, `overpass.ts`, `audience-scoring.ts` — работает
- **Не трогать** `/api/location-demo-analyze` — возвращает всё что нужно
- **Не трогать** `LocationIntelligenceDemo` deep logic — только добавить conditional UI block
- **Не строить** новый API endpoint — POST `/api/location-standalone-report` уже принимает и хранит
- **Не строить** новую страницу-лендинг — достаточно `/ru/location-analysis?mode=commercial`
- **Не удалять** `scoring.ts` (мёртвый код) сейчас — просто игнорировать, не мешает

---

## Итоговый план по часам

| Задача | Файлы | Часы | Visible result |
|---|---|---|---|
| 1. Mode selector | `ru/location-analysis/page.tsx` | 1–2 ч | ✅ Сразу два пути |
| 2. Flow structure UI block | `LocationIntelligenceDemo.tsx` | 2–3 ч | ✅ Коммерческий поток |
| 3. `buildCommercialFormatFit()` | `commercial-format-fit.ts` (новый) | 3–5 ч | ✅ Format fit grid |
| 4. `CommercialLocationReport` | `commercial-report.ts` (новый) | 3–4 ч | — (infrastructure) |
| 5. `LocationCommercialFullReport` | `LocationCommercialFullReport.tsx` (новый) | 4–6 ч | ✅ Shareable permalink |
| **Итого** | | **13–20 ч** | **First commercial MVP** |

---

_Связан с `location-commercial-existing-assets-audit.md` и `location-standalone-product-spec.md`._
