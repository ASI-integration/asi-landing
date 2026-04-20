# Neighborhood quality layer — MVP implementation (technical)

## Что внедрено

- **Отдельный слой** `neighborhoodEnvironment` на объекте `LocationAnalysis` (`src/lib/location/types.ts`): не участвует в `evergreenIndex`, `calcEvergreenIndex`, `buildLocationScoreOutput` и прочей коммерческой математике.
- **Числовой показатель** `environmentalFrictionScore` (0–100): чем выше, тем больше **физическая нагрузка среды** по нейтральным OSM-прокси (не «плохой район»).
- **Уровни concern** (`concernLevel`): `low` | `moderate` | `elevated` | `high` с человекочитаемыми подписями EN/RU (`concernLabelEn` / `concernLabelRu`).
- **Explainability**: массивы `reasonsEn` / `reasonsRu` (короткие формулировки) + опциональная связка с сильным коммерческим индексом (только текст, без изменения скоров).
- **Уверенность** `confidence`: `high` | `medium` | `low` по числу элементов и наличию «тяжёлых» геометрий в выборке.
- **Breakdown** `breakdown.*01`: нормализованные 0–1 субсигналы для отладки и будущего UI.
- **Расширение Overpass** (`src/lib/location/overpass.ts`): для env-селекторов добавлен флаг `allGeometries`, чтобы в **strict**-режиме запрашивались **way/relation**, а не только nodes (иначе магистрали и промзоны почти не попадали бы в выборку).
- **UI** (`src/components/LocationIntelligenceDemo.tsx` + `location-intelligence-locale.tsx`): блок «Living environment / Среда для проживания» под коммерческими пояснениями.
- **Обратная совместимость**: `patchLegacyLocationAnalysis` подставляет `emptyNeighborhoodEnvironmentLayer()`, если поля нет в кэше.

Основная логика: `src/lib/location/neighborhood-environment.ts`. Подключение к пайплайну: `buildAnalysis` в `src/lib/location/gravity-scoring.ts`.

## Какие сигналы вошли в MVP

| Сигнал | Источник в данных | Примечание |
|--------|-------------------|------------|
| Major roads / heavy traffic adjacency | `highway` ∈ motorway(+_link), trunk(+_link), primary(+_link), расстояние до ближайшего way/node | Прокси шума/потока ТС |
| Traffic-heavy corridor | Плотность `bus_stop` / `stop_position` / `tram_stop` в 320 м | Не смешивается с коммерческим бонусом за доступность |
| Industrial / logistics | `landuse=industrial`, `industrial=warehouse`, `man_made=works`, `building=industrial` | Счётчики + ближайший объект |
| Aviation / flight-path burden | `aeroway=runway`, `taxiway`, `aerodrome`/`terminal` с тем же anti-helipad фильтром, что и в `classifyElement` | ВПП + терминальная зона как прокси |
| Nightlife / late-night intensity | `amenity=nightclub`, `bar`, `pub` в малых радиусах | Только плотность/близость, без оценки людей |
| Harsh urban stack | Композит: сочетание сильных дорог + промки; дорог + nightlife; авиации + дорог | Небольшой capped бонус к итогу |
| Freight hint | `railway=rail` + (`usage=freight` или `freight=yes`) в 260 м | Лёгкий усилитель к дорожному блоку |

## Что пока не вошло

- Шумовые карты, AQI, официальные ДТП, 311/journal complaints.
- Полноценный граф пешеходных пересечений, `lit=*`, водные риски.
- Отдельный «лёгкий» Overpass только под env (сейчас селекторы добавлены в общий `fetchOsmData`).
- Использование `environmentalFrictionScore` как **modifier** к коммерческому score — только задел в архитектуре (отдельное поле).

## Ограничения MVP

- **OSM-полнота и тегирование** сильно варьируются по странам; при малом числе элементов снижается `confidence`.
- **Primary** в городах часто везде рядом — даёт умеренный FP «урбанный фон»; калибровка сознательно мягче, чем у motorway.
- **Стадионы / кино** как шум уже есть в коммерческих магнитах, но в MVP env **не дублируют** отдельным весом (можно добавить позже без смены контракта).
- **Время суток / события** не учитываются.
- Запрос стал тяжелее (доп. way/relation клаузы); при лимитах Overpass возможны таймауты — существующий fallback на minimal query **не** дублирует env-селекторы (minimal остаётся прежним).

## Как позже подключить как modifier

Импортировать `neighborhoodEnvironment` в выбранном месте (например, в `buildLocationScoreOutput` или отдельном post-process) и применять **мягкую** функцию от `environmentalFrictionScore` и `concernLevel`, не перезаписывая сырые коммерческие компоненты — например только `top_negative_factors` или отдельный UI-бейдж.
