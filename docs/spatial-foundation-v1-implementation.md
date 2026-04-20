# Spatial foundation v1 — implementation report

Wave 1 / Task 1 из `docs/platform-wave-1-execution-plan.md`: минимальный **spatial tier** для commercial/location core без крупного рефактора.

## Что реализовано

1. **Слой `spatial_tier` (stub)**  
   В типах зафиксированы значения `stub | graph | provider`; в проде v1 всегда `stub`. Резерв `graph` / `provider` под Phase 2.

2. **Barrier-aware логика (черновик)**  
   Из OSM выбираются точечные прокси барьеров: вода (`natural=water`, `waterway=riverbank`, `landuse=reservoir`), ж/д (`railway=rail`), крупные дороги (`highway` motorway/trunk/primary и `_link`).  
   Для каждого магнита на расстоянии **≥ 160 м** проверяется, лежит ли барьер ближе к субъекту, чем сам магнит, и близко ли к отрезку «субъект → магнит» (параметр `t` по сегменту и cross-track в локальной плоскости). При попадании к вкладу магнита применяется **один** худший множитель по классу барьера (не перемножение дублей).

3. **Corridor / snap (минимум)**  
   В выборку Overpass добавлены «пешеходные» `highway` (residential, secondary, tertiary, living_street, pedestrian, unclassified, service). Расстояние от точки до ближайшего такого сэмпла — **`corridorSnapM`**. В затухание дистанции для пересчёта `attractionScore` добавляется инфляция `min(95, round(corridorSnapM * 0.32))` метров (мягкий штраф, если точка далеко от оси коридора).

4. **Согласование с commercial standalone и UI**  
   - `LocationAnalysis` дополнен снимком `spatialFoundation`.  
   - `buildCommercialReport` всегда кладёт блок `spatial` в JSON отчёта (для старых объектов без поля в анализе подставляется «выключенный» stub через `createDisabledSpatialFoundation`).  
   - `CommercialReportView` показывает tier, флаги `barrier_penalty_applied`, коридор и пояснение уверенности.  
   - `buildCommercialFormatFit` добавляет ограничивающие факторы при активном stub и при фактическом барьерном штрафе.

5. **Без молчаливого изменения residential**  
   Коррекция магнитов включается только при `buildAnalysis(..., { spatialFoundation: true })`.  
   - `/api/location-demo-analyze` с телом `{ spatialFoundation: true }` (коммерческий режим в UI) **не читает и не пишет** общий coord-cache — чтобы не затирать residential-эталон и не смешивать варианты.  
   - Кэш по умолчанию и `/api/location-report` остаются на `spatialFoundation: false`.

## Новые поля и сигналы

### `LocationAnalysis.spatialFoundation` (`SpatialFoundationSnapshot`)

| Поле | Назначение |
|------|------------|
| `spatialTier` | `stub` (v1) |
| `enabled` | Были ли применены коррекции к `attractionScore` |
| `barrierPenaltyApplied` | Хотя бы один магнит получил множитель &lt; 1 (для JSON explainability / логов) |
| `penalizedMagnetCount` | Сколько магнитов получили dampening |
| `corridorSnapM` | м до ближайшего corridor-proxy или `null` |
| `barrierKindsDetected` | Уникальные классы барьеров в окне выборки |
| `distanceInflationM` | Добавка к дистанции в затухании (из коридора) |
| `geometricConfidenceNoteRu` | Текст для UI/отчёта о черновой геометрии |

### `LocationCommercialReport.spatial` (JSON отчёта)

Зеркалирует снимок в snake_case: `spatial_tier`, `enabled`, `barrier_penalty_applied`, `corridor_snap_m`, `distance_inflation_m`, `barrier_kinds`, `geometric_confidence_note_ru`.

### Overpass

Добавлены лёгкие strict-селекторы: вода / reservoir / riverbank и пешеходные `highway` для коридора.

## Влияние на commercial verdict

- Изменяется **только** траектория с `spatialFoundation: true` (коммерческий запрос в демо).  
- Снижаются `attractionScore` отдельных магнитов → меняются `evergreenIndex`, foot-traffic производные, `buildCommercialFormatFit` (пороги по индексу и потоку).  
- В матрицу форматов добавляются **ограничивающие** строки: про stub-геометрию и (если было) про `barrier_penalty_applied`, чтобы high/medium не читались как «точная пешеходная геометрия».

## Отображение в UI / report

- Страница коммерческого permalink: блок **Spatial** под дисклеймером — tier, активность слоя, бейдж `barrier_penalty_applied`, коридор + инфляция, список классов барьеров, `geometric_confidence_note_ru`.  
- Лимитирующие факторы в секции форматной матрицы (см. выше).

## Тесты

`src/lib/location/__tests__/spatial-foundation.test.ts` — три синтетических layout (вода на луче, вода в стороне, рельсы на луче) плюс интеграция `applySpatialFoundationLayer` и разбор тегов барьеров.

## Phase 2 (что сознательно не делали)

- Граф улиц / маршрутизация пешехода (`graph`).  
- Внешний провайдер мобильности / footfall (`provider`).  
- Точная геометрия way-полилиний вместо `center` / узлов.  
- Отдельный ключ кэша для spatial-варианта без полного пересчёта OSM.  
- Единый runner-гейт из Wave 1 Task 2 (это отдельная задача).
