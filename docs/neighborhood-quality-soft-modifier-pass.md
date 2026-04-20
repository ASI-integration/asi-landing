# Neighborhood quality — soft commercial headline modifier (pass 1)

## Цель

Смягчить ложную «премиальность» и слишком ровный позитивный тон итогового **композитного балла** (`location_score`), не переписывая базовую gravity/evergreen модель и **не меняя** `evergreenIndex`. Модификатор — отдельный пост-слой с явным снимком состояния и возможностью отключения.

## Реализация (код)

| Компонент | Назначение |
|-----------|------------|
| `src/lib/location/neighborhood-environment-commercial-modifier.ts` | Чистая функция `computeNeighborhoodEnvironmentCommercialModifier` — вся логика штрафа/пропусков/текстов. |
| `src/lib/location/gravity-scoring.ts` | После `buildLocationScoreOutput` и слоя среды вычисляет снимок и при необходимости применяет `withAdjustedLocationScoreHeadline`. |
| `src/lib/location/location-score.ts` | `withAdjustedLocationScoreHeadline` — пересчитывает только headline: `location_score`, `rating`, доходность и стратегию; **breakdown** без изменений. |
| `src/lib/location/config.ts` | `NEIGHBORHOOD_ENV_SCORE_MODIFIER` — порог OSM (`minOsmElementsForPenalty: 10`) и жёсткий потолок −9 пунктов к баллу. |
| `LocationAnalysis.commercialNeighborhoodModifier` | Снимок для UI/API: до/после, причина пропуска, предупреждения. |

### Отключение

Переменная окружения: `ASI_NEIGHBORHOOD_ENV_SCORE_MODIFIER=0` (или `false` / `off`) — слой считается выключенным, `applied: false`, headline не трогается.

## Правила применения

1. **Уровень среды** (`neighborhoodEnvironment.concernLevel`): штраф только при `elevated` или `high`. Для `low` / `moderate` — только существующий текстовый слой среды, headline не меняется.
2. **Уверенность подмодели среды**: при `confidence === 'low'` числовой штраф **не** применяется. Для сочетания **high concern + low confidence** — флаг `warningOnlyHighConcernLowConfidence` и поясняющий текст (без penalty).
3. **OSM-полнота**: если `osmElementCount < 10`, штраф не применяется (`skipReason: 'osm_too_sparse'`), чтобы не наказывать при явно разреженной выборке.
4. **Номинальные доли** (до капов):  
   - `elevated` + `medium` → 3%; `elevated` + `high` → 4.5%.  
   - `high` + `medium` → 6%; `high` + `high` → 8%.  
5. **Капы**: округление до целых пунктов; глобальный потолок `maxPointReduction = 9`; плюс **пол strong-бэнда**: при базовом headline **≥ 70** снятие не опускает итог ниже **70** за один проход (`strongBandFloorApplied`), чтобы один мягкий слой не переводил локацию из strong в viable «одним махом».

`evergreenIndex`, магниты, давление конкурентов и прочие входы базовой модели не меняются.

## Контрольный прогон (без глобального 100-case)

База: `scripts/neighborhood-quality-control-results.json`. Таблица ниже синхронизирована с `npx --yes tsx scripts/neighborhood-quality-soft-modifier-from-json.ts` (повторный расчёт снимка модификатора по сохранённым `commercial` + `neighborhood` + `elementCount`).

**Дозакрытие пропусков (2026-04-18):** пять строк чеклиста с таймаутами в основном контроле (`times_square`, `kazan_center`, `sochi_center`, `lyubertsy`, `pechatniki`) прогнаны точечно скриптом `scripts/neighborhood-quality-soft-modifier-missing-retry.ts` (таймаут **360 s** на кейс, слияние в `neighborhood-quality-control-results.json` после каждого успеха; аудит: `scripts/neighborhood-quality-soft-modifier-missing-retry.json`). Полный контрольный набор не пересчитывался.

Вне чеклиста по-прежнему нет данных для **Long Island City (`lic_queens`)** — таймаут в исходном прогоне; на выводы по soft modifier для запрошенного чеклиста это не влияет.

### Сводная таблица (запрошенный чеклист)

| Case | EV | Base loc | NE tier | NE conf | OSM n | Applied | After | Δ |
|------|--:|----------|---------|---------|------|---------|------|--:|
| ozone_park | 97 | 100 | elevated | high | 131 | yes | 95 | -5 |
| times_square | 100 | 74 | moderate | high | 452 | no | 74 | 0 |
| cannes | 100 | 71 | high | high | 396 | yes | 70 | -1 |
| causeway_bay | 100 | 80 | moderate | high | 824 | no | 80 | 0 |
| kazan_center | 100 | 80 | moderate | high | 264 | no | 80 | 0 |
| sochi_center | 63 | 65 | elevated | high | 129 | yes | 62 | -3 |
| el_poblado | 80 | 62 | moderate | high | 227 | no | 62 | 0 |
| miami_brickell | 100 | 92 | moderate | high | 162 | no | 92 | 0 |
| dubai_marina | 23 | 47 | moderate | high | 78 | no | 47 | 0 |
| canary_wharf | 65 | 76 | moderate | high | 278 | no | 76 | 0 |
| lyubertsy | 96 | 88 | elevated | high | 142 | yes | 84 | -4 |
| pechatniki | 56 | 89 | moderate | high | 47 | no | 89 | 0 |

### Коротко по строкам с данными

- **Ozone Park** — базовый headline 100 при `elevated` и высокой уверенности среды выглядел нереалистично «идеально»; −5 пунктов (номинал ~4.5%) оставляет **95** и рейтинг **exceptional**; `evergreenIndex` 97 не тронут — честный сильный транспортно-городской сигнал сохранён, снята только часть ложной премиальности headline.
- **Cannes** — по OSM-прокси среда `high`, но базовый headline уже на пороге strong (71); сработал **пол 70** (`strongBandFloorApplied`): фактически **−1** до 70, рейтинг strong сохранён; сильный коммерческий кейс не сломан.
- **Times Square, Kazan, Pechatniki** — после дозагрузки уровень среды **`moderate`** при высокой уверенности → по ТЗ числовой штраф не применяется; для Times Square это важная проверка, что слой не «карает» иконический CBD только за плотность OSM-прокси.
- **Sochi center** — `elevated` + высокая уверенность: **−3** к headline (65→62), без смены рейтингового бэнда viable; усиливает осторожность тона при уже умеренном evergreen (**63**).
- **Lyubertsy (weak suburb)** — `elevated`, сильный evergreen (**96**) при шумной карте: **−4** (88→84), остаётся **strong** — снимается часть «слишком идеального» headline без ломки сильного коммерческого сигнала.
- **Causeway Bay / Brickell / Dubai Marina / Canary Wharf / El Poblado** — уровень среды `moderate` → только нарратив, headline без изменений; для Dubai Marina слабый EV/балл остаётся отражением базовой модели, модификатор не «дожимает» слабую локацию.

## Ответы на вопросы из ТЗ

1. **Помогает ли soft modifier уменьшить ложную премиальность?**  
   Да, в первую очередь там, где headline был завышен относительно напряжённой среды при `elevated`/`high` и достаточной уверенности/OSM — типичный пример в данных: **Ozone Park** (100 → 95).

2. **Какие кейсы улучшились сильнее всего?**  
   По величине сдвига headline — **Ozone Park** (−5) и **Lyubertsy** (−4 при сохранении strong). **Cannes** получает лишь минимальный сдвиг из‑за пола strong-бэнда — сознательный обмен: меньше числового «штрафа», зато не ломаем сильный рейтинговый бэнды. **Sochi** (−3) дополняет картину «elevated среда / умеренный evergreen».

3. **Какие кейсы пока не спасает / не затрагивает?**  
   Все **`moderate`** по среде (по спецификации pass 1 — без числа). Любые проблемы при **низкой confidence** среды или **очень разреженном OSM**. Ситуации, где завышение идёт из самой коммерческой модели, а не из диссонанса «сильный спрос / шумная среда». Вне чеклиста: **LIC** без успешного fetch.

4. **Следующий шаг к целевым ~90%?**  
   Это **разумный следующий микрошаг**: отдельный слой, капы, зависимость от confidence и OSM, неизменный evergreen. Для pass-1 по **чеклисту модификатора** данных теперь достаточно. До «~90%» общего качества сценариев всё ещё полезны расширенная валидация, точечный retry для **lic_queens** при необходимости и калибровка долей; при необходимости — отдельное обсуждение пола 70 для «туристических сильных с высоким трением среды».
