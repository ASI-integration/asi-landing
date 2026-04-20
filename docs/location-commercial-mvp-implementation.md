# Location Commercial MVP — Implementation Report

## Что было реализовано

### Задача 1 — Режим коммерческой / жилой локации

**Страницы:**
- `/ru/location-analysis?mode=commercial` — коммерческий режим
- `/ru/location-analysis` (без параметра) — жилой режим (по умолчанию)
- `/features/location-analysis?mode=commercial` — EN (mode toggle в компоненте)

**Что сделано:**
- `LocationIntelligenceDemo` получил пропс `initialMode?: 'residential' | 'commercial'`
- В UI добавлены переключаемые таб-кнопки «Жилая / Коммерческая» (только `locale === 'ru'`)
- При смене режима: URL обновляется через `router.replace`, стейт анализа сбрасывается
- Страница `/ru/location-analysis/page.tsx` читает `searchParams.mode` и передаёт в компонент
- В коммерческом режиме: другой H1, другой subheadline, другой CTA-текст кнопки

**Ключевые файлы:**
- `src/app/ru/location-analysis/page.tsx`
- `src/app/features/location-analysis/page.tsx`
- `src/components/LocationIntelligenceDemo.tsx`

---

### Задача 2 — Блок «Структура потока»

**Что реализовано:**
- `CommercialFlowBlock` — внутренний компонент `LocationIntelligenceDemo.tsx`
- Визуализирует `footTraffic.transitVsTarget` (3 бара: транзитный / локальный / целевой)
- Каждый бар: процент + прогресс-бар + короткое описание
- Автоматический вывод-заключение (1 строка):
  - «У точки есть сильный целевой поток» при `destinationShare >= 0.45`
  - «В локации преобладает транзитный поток» при `transitShare >= 0.50`
  - «Активная локальная аудитория» при `localActiveShare >= 0.40`
  - Иначе — «Поток смешанный»
- Отображается в `CommercialASIPanel` (правая колонка результата в коммерческом режиме)

**Переиспользованные сигналы:**
- `analysis.footTraffic.transitVsTarget` (уже вычислялось движком)
- `analysis.footTraffic.movementDensity`

---

### Задача 3 — `buildCommercialFormatFit()`

**Файл:** `src/lib/location/commercial-format-fit.ts`

**Типы:**
```typescript
CommercialFormatType: 'retail' | 'food_beverage' | 'service' | 'convenience' | 'showroom' | 'destination_venue'
CommercialFormatFitLevel: 'high' | 'medium' | 'low' | 'poor'
CommercialFormatFitEntry: { format, formatLabelRu, fitLevel, explanationRu, supportingFactorsRu, limitingFactorsRu }
CommercialFormatFit: { entries, overallVerdict, overallVerdictLabelRu, bestFormats }
```

**Сигналы, которые используются:**
- `footTraffic.transitVsTarget` — структура потока
- `evergreenIndex` — общая сила локации
- `demandType` — тип доминирующего спроса
- `magnets` — наличие и типы якорных объектов
- `gravityExplanation.competitorPressureLevel` — конкурентное давление
- `gravityExplanation.clusterDetected` — кластер притяжения
- `neighborhoodEnvironment.breakdown` — барьеры окружения (промышленность, дороги)
- `audienceAnalysis.businessClusterDetected` — деловой кластер

**Логика — rule-based, не ML:**
- Каждый формат проверяет набор порогов на сигналах → присваивает fitLevel
- Для каждого fitLevel генерируются supporting/limiting factors
- `computeOverallVerdict` считает distribution по fitLevel → 'strong' / 'selective' / 'weak' / 'poor'
- `bestFormats` — первые 1–2 формата с high/medium fit

---

### Задача 4 — Коммерческий тип отчёта

**Файл:** `src/lib/location/standalone-report.ts` (расширен)

**Новый тип:** `LocationCommercialReport` (`version: 'v2-commercial'`)

**Структура отчёта:**
```typescript
{
  version: 'v2-commercial',
  address, generated_at_iso,
  flow: { transitShare, localActiveShare, destinationShare, flowCharacter, modifierTier, flowConclusion },
  formatFit: { overallVerdict, overallVerdictLabelRu, entries[] },
  anchors: [{ categoryId, name, distance_m, icon }],
  barriers: string[],
  competition: { competitor_count, pressure_level },
  recommendation: string,
}
```

**Новые функции:**
- `isLocationCommercialReport(x)` — type guard
- `buildCommercialReport({ address, analysis })` — builder

**API route** (`/api/location-standalone-report`) расширен: принимает оба типа (`v1` и `v2-commercial`). Тот же Supabase-стол `location_standalone_reports`.

**Переиспользование:** тот же `/api/location-standalone-report`, та же Supabase-персистенция, тот же permalink-механизм.

---

### Задача 5 — CommercialReportView

**Файл:** `src/components/location/CommercialReportView.tsx`

**Разделы отчёта:**
1. Заголовок: адрес, дата, overall verdict pill
2. TOC-навигация (якоря)
3. **Структура потока** — 3 прогресс-бара + вывод
4. **Форматная матрица** — 6 форматов с fitLevel badge, объяснением, supporting/limiting факторами
5. **Якоря и магниты** — список с иконками и дистанцией
6. **Барьеры и ограничения** — OSM-based сигналы
7. **Конкуренция** — счётчик + уровень давления
8. **Итоговый вывод** — verdict + recommendation + дисклеймер

**Роут:** `/ru/location-report/[reportId]/page.tsx` — при `isLocationCommercialReport(entity.report)` рендерит `CommercialReportView` вместо `LocationStandaloneFullReport`.

---

## Что было переиспользовано

| Компонент | Переиспользован |
|-----------|----------------|
| `/api/location-standalone-report` API route | ✅ без дублирования |
| `location_standalone_reports` Supabase таблица | ✅ та же |
| `standalone-report-store.ts` (createStandaloneReport, getStandaloneReportById) | ✅ без изменений |
| `/ru/location-report/[reportId]/page.tsx` | ✅ расширен (не переписан) |
| `FootTrafficSummary.transitVsTarget` | ✅ уже вычислялось |
| `magnetFlowWeights()` (внутри foot-traffic.ts) | ✅ уже было |
| `demandType`, `audienceSharePct` | ✅ уже вычислялись |
| `neighborhoodEnvironment.breakdown` | ✅ уже вычислялось |
| `evergreenIndex`, `magnets`, `competitors` | ✅ уже было |
| `LocationIntelligenceDemo` компонент | ✅ расширен через пропс + режим |

## Что новое

| Файл | Назначение |
|------|-----------|
| `src/lib/location/commercial-format-fit.ts` | Core logic: buildCommercialFormatFit() |
| `src/components/location/CommercialReportView.tsx` | Full commercial report UI |
| `CommercialFlowBlock` (в demo) | Flow structure UI block |
| `CommercialFormatFitBlock` (в demo) | Format fit matrix в панели результата |
| `CommercialASIPanel` (в demo) | Правая панель в commercial mode |

---

## Что сейчас работает

### Страницы
- `/ru/location-analysis` — жилой режим (без изменений)
- `/ru/location-analysis?mode=commercial` — **коммерческий режим** с другим H1, другим bridge-блоком
- UI переключатель «Жилая / Коммерческая» виден в обоих режимах

### Анализ (commercial mode)
- После ввода адреса: стандартный OSM-анализ (тот же engine, без изменений)
- В правой панели: `CommercialASIPanel` вместо стандартного `ASIPanel`
  - Индекс + overall verdict
  - Структура потока (3 бара)
  - Форматная матрица (6 форматов с fitLevel)
  - CTA «Открыть пространственный отчёт»

### Отчёт
- `buildCommercialReport()` создаёт `LocationCommercialReport` (version: v2-commercial)
- Сохраняется через тот же API → Supabase
- Permalink: `/ru/location-report/{reportId}` → рендерит `CommercialReportView`
- Shareable: да

---

## Чего не хватает до следующей фазы

1. **Heatmap в commercial отчёте** — сейчас нет карты в `CommercialReportView`. Есть в demo-панели (heatmap panel левая колонка), но не в полном отчёте.

2. **Micro-catchment / corridor logic** — зона охвата по типу формата (пешая/автомобильная). Данные есть в engine, но не распакованы.

3. **EN-версия commercial mode** — toggle скрыт для `locale !== 'ru'`, commercial mode не переведён. `/features/location-analysis?mode=commercial` технически работает, но UI и copy — RU-ориентированы.

4. **Retail intent refinement** — уточнение через категорию формата (розница, F&B, сервис) как дополнительный входной параметр. Сейчас оценивается автоматически.

5. **Валидация на реальных точках** — commercial format fit ещё не проходил control-run на 10+ точках. Логика rule-based, пороги консервативные, но нужна проверка.

6. **Competition snapshot by format** — сейчас берётся общий `competitors.length`. Хорошо бы фильтровать по категории конкурента.

7. **Метаданные для SEO** — `CommercialReportView` не добавляет динамические `metadata` (Open Graph, title по адресу).

---

## Можно ли считать это первым публичным Commercial MVP

**Да.** Всё необходимое для MVP работает:
- Пользователь видит два режима и переключается
- В коммерческом режиме получает принципиально другой вывод (не income/strategy, а flow + format fit)
- Отчёт сохраняется и доступен по ссылке
- Тон профессиональный, без «магических» претензий на точность
- Дисклеймер о предварительном характере анализа присутствует

Главный пробел — отсутствие проверки на реальных точках и heatmap в полном отчёте.
