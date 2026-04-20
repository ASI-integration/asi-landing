# Spatial Foundation v1 — commercial validation (A/B)

**Дата:** 2026-04-19  
**Метод:** один и тот же live OSM fetch на кейс → `buildAnalysis(..., { spatialFoundation: false })` vs `true` → `buildCommercialFormatFit`.

Исходные данные: `scripts/commercial-spatial-foundation-v1-ab.json`. Legacy выгрузка «только after»: `scripts/commercial-format-fit-validation-results.json`.

---

## 0. Качество fetch (Overpass)

Успешных запросов: **9 / 20**. Ошибок (таймаут 120s): **11** (центры Москвы, Лондона, Парижа, Нью‑Йорка и др. не попали в выборку в этом окне).

Среди успешных кейсов **ровно один** (`gorky_park_moscow`) дал отличие `before.fitMap` vs `after.fitMap`; в остальных восьми уровни форматов не сдвинулись — изменились в основном **limiting factors** (stub‑дисклеймер + строка про `barrier_penalty_applied`, когда penalty=true).

Повторите `npx tsx scripts/commercial-format-fit-validation.ts`, когда Overpass стабилен, чтобы получить полную матрицу 20× и сравнить транзитные/туристические якоря.

**Доп. наблюдение (ранний прогон того же дня, не вошло в финальный JSON):** при удачном fetch для `kursky_station_moscow` отмечалось **convenience medium→high** при `spatialFoundation: true` — полезный транзитный паттерн для повторной проверки после стабилизации API.

---

## 1. Сводка

| Класс | Кейсы (20 всего) |
|--------|----------------|
| Улучшились (вердикт / human critical / primary vs human — см. автоклассификатор) | gorky_park_moscow |
| Без эффекта (вердикт, fitMap, barriers, limiting — совпали) | — |
| Регрессии | — |
| Смешанный сигнал | covent_garden_london, vdnkh_moscow, el_poblado_medellin, leningradsky_showroom_moscow, dubai_marina, lyubertsy_center, pokrovskoye_streshnevo, khamovniki_moscow |

### Где что произошло по смыслу (не только метка скрипта)

- **Реально улучшился fitMap (и частично human‑матрица):** `gorky_park_moscow` — см. §3 внизу: convenience high→medium, showroom high→low, destination_venue medium→high; число human **critical** расхождений 2→1.
- **Spatial почти не тронул скоринг (только объяснения):** восемь кейсов выше в «mixed»: `fitMap` идентичен, меняются limiting + часто `barrier_penalty_applied` и список `barrierKindsDetected`.
- **Регрессий вердикта / primary на успешной девятке нет.**

### «Топ‑5» в честном виде

В этом прогоне объективно выделить **пять** независимых сильных улучшений **уровней** format‑fit нельзя: материальный сдвиг дал только Парк Горького. Остальные ID из автоматического ранжирования по `gain` имели **нулевой** сдвиг primary и не должны трактоваться как «топ улучшений».

---

## 2. Таблица before → after

| ID | Вердикт | Primary fit | Spatial (after) | Barriers Δ |
|----|---------|---------------|-----------------|------------|
| covent_garden_london | strong → strong | high → high | tier=stub, penalty=true, kinds=major_road/rail/water | — |
| vdnkh_moscow | strong → strong | medium → medium | tier=stub, penalty=true, kinds=water | — |
| el_poblado_medellin | strong → strong | high → high | tier=stub, penalty=true, kinds=major_road | — |
| leningradsky_showroom_moscow | strong → strong | high → high | tier=stub, penalty=true, kinds=water | — |
| dubai_marina | strong → strong | medium → medium | tier=stub, penalty=true, kinds=major_road/water | — |
| lyubertsy_center | weak → weak | low → low | tier=stub, penalty=true, kinds=major_road/water | — |
| pokrovskoye_streshnevo | weak → weak | medium → medium | tier=stub, penalty=false, kinds=water | — |
| khamovniki_moscow | strong → strong | medium → medium | tier=stub, penalty=true, kinds=major_road/water | — |
| gorky_park_moscow | strong → strong | high → high | tier=stub, penalty=true, kinds=major_road/rail/water | — |

---

## 3. Карточки по кейсам (verdict, format‑fit, barriers, limiting, spatial tier)

### red_square_moscow
**Ошибка:** red_square_moscow: timed out after 120000ms

### arbat_moscow
**Ошибка:** arbat_moscow: timed out after 120000ms

### tverskaya_moscow
**Ошибка:** tverskaya_moscow: timed out after 120000ms

### nevsky_spb
**Ошибка:** nevsky_spb: timed out after 120000ms

### kursky_station_moscow
**Ошибка:** kursky_station_moscow: timed out after 120000ms

### gare_du_nord_paris
**Ошибка:** gare_du_nord_paris: timed out after 120000ms

### moscow_city
**Ошибка:** moscow_city: timed out after 120000ms

### canary_wharf_london
**Ошибка:** canary_wharf_london: timed out after 120000ms

### covent_garden_london — Covent Garden, Лондон

**Классификация:** mixed (verdict strong→strong; primary(destination_venue) high→high; human critical 0→0; spatial penalty false→true)

| Поле | Before (SF off) | After (SF on) |
|------|-------------------|---------------|
| Вердикт | strong (Сильная коммерческая точка) | strong (Сильная коммерческая точка) |
| Spatial tier | stub enabled=false | stub enabled=true |
| barrier_penalty | false (0 magnets) | true (12) |
| Barriers (report‑style) | Ночная активность — возможные конфликты формата; Высокая конкурентная плотность | Ночная активность — возможные конфликты формата; Высокая конкурентная плотность |

**Format fit (limiting factors — только если отличаются):**

- **retail** high → high
  - limiting before: Высокая конкурентная плотность
  - limiting after: Высокая конкурентная плотность | Черновая геометрия (stub): пешеходный доступ не по графу улиц — подтвердите на месте. | Дальние якоря частично ослаблены из‑за барьеров между точкой и объектом (barrier_penalty_applied).
- **food_beverage** high → high
  - limiting before: —
  - limiting after: Черновая геометрия (stub): пешеходный доступ не по графу улиц — подтвердите на месте. | Дальние якоря частично ослаблены из‑за барьеров между точкой и объектом (barrier_penalty_applied).
- **service** medium → medium
  - limiting before: —
  - limiting after: Черновая геометрия (stub): пешеходный доступ не по графу улиц — подтвердите на месте. | Дальние якоря частично ослаблены из‑за барьеров между точкой и объектом (barrier_penalty_applied).
- **convenience** medium → medium
  - limiting before: Туристическая аудитория не формирует стабильный повседневный спрос
  - limiting after: Туристическая аудитория не формирует стабильный повседневный спрос | Черновая геометрия (stub): пешеходный доступ не по графу улиц — подтвердите на месте. | Дальние якоря частично ослаблены из‑за барьеров между точкой и объектом (barrier_penalty_applied).
- **showroom** low → low
  - limiting before: Туристический поток не конвертируется в аудиторию шоурума | Перегруженные дороги рядом затрудняют парковку и доступ
  - limiting after: Туристический поток не конвертируется в аудиторию шоурума | Перегруженные дороги рядом затрудняют парковку и доступ | Черновая геометрия (stub): пешеходный доступ не по графу улиц — подтвердите на месте. | Дальние якоря частично ослаблены из‑за барьеров между точкой и объектом (barrier_penalty_applied).
- **destination_venue** high → high
  - limiting before: —
  - limiting after: Черновая геометрия (stub): пешеходный доступ не по графу улиц — подтвердите на месте. | Дальние якоря частично ослаблены из‑за барьеров между точкой и объектом (barrier_penalty_applied).

### shoreditch_london
**Ошибка:** shoreditch_london: timed out after 120000ms

### times_square_nyc
**Ошибка:** times_square_nyc: timed out after 120000ms

### vdnkh_moscow — ВДНХ, Москва

**Классификация:** mixed (verdict strong→strong; primary(destination_venue) medium→medium; human critical 1→1; spatial penalty false→true)

| Поле | Before (SF off) | After (SF on) |
|------|-------------------|---------------|
| Вердикт | strong (Сильная коммерческая точка) | strong (Сильная коммерческая точка) |
| Spatial tier | stub enabled=false | stub enabled=true |
| barrier_penalty | false (0 magnets) | true (6) |
| Barriers (report‑style) | — | — |

**Format fit (limiting factors — только если отличаются):**

- **retail** high → high
  - limiting before: —
  - limiting after: Черновая геометрия (stub): пешеходный доступ не по графу улиц — подтвердите на месте. | Дальние якоря частично ослаблены из‑за барьеров между точкой и объектом (barrier_penalty_applied).
- **food_beverage** high → high
  - limiting before: —
  - limiting after: Черновая геометрия (stub): пешеходный доступ не по графу улиц — подтвердите на месте. | Дальние якоря частично ослаблены из‑за барьеров между точкой и объектом (barrier_penalty_applied).
- **service** medium → medium
  - limiting before: —
  - limiting after: Черновая геометрия (stub): пешеходный доступ не по графу улиц — подтвердите на месте. | Дальние якоря частично ослаблены из‑за барьеров между точкой и объектом (barrier_penalty_applied).
- **convenience** high → high
  - limiting before: —
  - limiting after: Черновая геометрия (stub): пешеходный доступ не по графу улиц — подтвердите на месте. | Дальние якоря частично ослаблены из‑за барьеров между точкой и объектом (barrier_penalty_applied).
- **showroom** high → high
  - limiting before: —
  - limiting after: Черновая геометрия (stub): пешеходный доступ не по графу улиц — подтвердите на месте. | Дальние якоря частично ослаблены из‑за барьеров между точкой и объектом (barrier_penalty_applied).
- **destination_venue** medium → medium
  - limiting before: —
  - limiting after: Черновая геометрия (stub): пешеходный доступ не по графу улиц — подтвердите на месте. | Дальние якоря частично ослаблены из‑за барьеров между точкой и объектом (barrier_penalty_applied).

### el_poblado_medellin — El Poblado, Медельин

**Классификация:** mixed (verdict strong→strong; primary(food_beverage) high→high; human critical 1→1; spatial penalty false→true)

| Поле | Before (SF off) | After (SF on) |
|------|-------------------|---------------|
| Вердикт | strong (Сильная коммерческая точка) | strong (Сильная коммерческая точка) |
| Spatial tier | stub enabled=false | stub enabled=true |
| barrier_penalty | false (0 magnets) | true (6) |
| Barriers (report‑style) | Ночная активность — возможные конфликты формата; Высокая конкурентная плотность | Ночная активность — возможные конфликты формата; Высокая конкурентная плотность |

**Format fit (limiting factors — только если отличаются):**

- **retail** high → high
  - limiting before: Высокая конкурентная плотность
  - limiting after: Высокая конкурентная плотность | Черновая геометрия (stub): пешеходный доступ не по графу улиц — подтвердите на месте. | Дальние якоря частично ослаблены из‑за барьеров между точкой и объектом (barrier_penalty_applied).
- **food_beverage** high → high
  - limiting before: —
  - limiting after: Черновая геометрия (stub): пешеходный доступ не по графу улиц — подтвердите на месте. | Дальние якоря частично ослаблены из‑за барьеров между точкой и объектом (barrier_penalty_applied).
- **service** high → high
  - limiting before: —
  - limiting after: Черновая геометрия (stub): пешеходный доступ не по графу улиц — подтвердите на месте. | Дальние якоря частично ослаблены из‑за барьеров между точкой и объектом (barrier_penalty_applied).
- **convenience** high → high
  - limiting before: —
  - limiting after: Черновая геометрия (stub): пешеходный доступ не по графу улиц — подтвердите на месте. | Дальние якоря частично ослаблены из‑за барьеров между точкой и объектом (barrier_penalty_applied).
- **showroom** medium → medium
  - limiting before: Ограниченная транспортная доступность | Перегруженные дороги рядом затрудняют парковку и доступ
  - limiting after: Ограниченная транспортная доступность | Перегруженные дороги рядом затрудняют парковку и доступ | Черновая геометрия (stub): пешеходный доступ не по графу улиц — подтвердите на месте. | Дальние якоря частично ослаблены из‑за барьеров между точкой и объектом (barrier_penalty_applied).
- **destination_venue** medium → medium
  - limiting before: —
  - limiting after: Черновая геометрия (stub): пешеходный доступ не по графу улиц — подтвердите на месте. | Дальние якоря частично ослаблены из‑за барьеров между точкой и объектом (barrier_penalty_applied).

### leningradsky_showroom_moscow — Ленинградский пр-т (авто-шоурумы), Москва

**Классификация:** mixed (verdict strong→strong; primary(showroom) high→high; human critical 3→3; spatial penalty false→true)

| Поле | Before (SF off) | After (SF on) |
|------|-------------------|---------------|
| Вердикт | strong (Сильная коммерческая точка) | strong (Сильная коммерческая точка) |
| Spatial tier | stub enabled=false | stub enabled=true |
| barrier_penalty | false (0 magnets) | true (6) |
| Barriers (report‑style) | — | — |

**Format fit (limiting factors — только если отличаются):**

- **retail** high → high
  - limiting before: —
  - limiting after: Черновая геометрия (stub): пешеходный доступ не по графу улиц — подтвердите на месте. | Дальние якоря частично ослаблены из‑за барьеров между точкой и объектом (barrier_penalty_applied).
- **food_beverage** high → high
  - limiting before: —
  - limiting after: Черновая геометрия (stub): пешеходный доступ не по графу улиц — подтвердите на месте. | Дальние якоря частично ослаблены из‑за барьеров между точкой и объектом (barrier_penalty_applied).
- **service** medium → medium
  - limiting before: —
  - limiting after: Черновая геометрия (stub): пешеходный доступ не по графу улиц — подтвердите на месте. | Дальние якоря частично ослаблены из‑за барьеров между точкой и объектом (barrier_penalty_applied).
- **convenience** medium → medium
  - limiting before: Туристическая аудитория не формирует стабильный повседневный спрос
  - limiting after: Туристическая аудитория не формирует стабильный повседневный спрос | Черновая геометрия (stub): пешеходный доступ не по графу улиц — подтвердите на месте. | Дальние якоря частично ослаблены из‑за барьеров между точкой и объектом (barrier_penalty_applied).
- **showroom** high → high
  - limiting before: —
  - limiting after: Черновая геометрия (stub): пешеходный доступ не по графу улиц — подтвердите на месте. | Дальние якоря частично ослаблены из‑за барьеров между точкой и объектом (barrier_penalty_applied).
- **destination_venue** high → high
  - limiting before: —
  - limiting after: Черновая геометрия (stub): пешеходный доступ не по графу улиц — подтвердите на месте. | Дальние якоря частично ослаблены из‑за барьеров между точкой и объектом (barrier_penalty_applied).

### dubai_marina — Dubai Marina, Дубай

**Классификация:** mixed (verdict strong→strong; primary(destination_venue) medium→medium; human critical 0→0; spatial penalty false→true)

| Поле | Before (SF off) | After (SF on) |
|------|-------------------|---------------|
| Вердикт | strong (Сильная коммерческая точка) | strong (Сильная коммерческая точка) |
| Spatial tier | stub enabled=false | stub enabled=true |
| barrier_penalty | false (0 magnets) | true (10) |
| Barriers (report‑style) | Близость авиационных объектов (шум); Высокая конкурентная плотность | Близость авиационных объектов (шум); Высокая конкурентная плотность |

**Format fit (limiting factors — только если отличаются):**

- **retail** high → high
  - limiting before: Высокая конкурентная плотность
  - limiting after: Высокая конкурентная плотность | Черновая геометрия (stub): пешеходный доступ не по графу улиц — подтвердите на месте. | Дальние якоря частично ослаблены из‑за барьеров между точкой и объектом (barrier_penalty_applied).
- **food_beverage** high → high
  - limiting before: —
  - limiting after: Черновая геометрия (stub): пешеходный доступ не по графу улиц — подтвердите на месте. | Дальние якоря частично ослаблены из‑за барьеров между точкой и объектом (barrier_penalty_applied).
- **service** high → high
  - limiting before: —
  - limiting after: Черновая геометрия (stub): пешеходный доступ не по графу улиц — подтвердите на месте. | Дальние якоря частично ослаблены из‑за барьеров между точкой и объектом (barrier_penalty_applied).
- **convenience** high → high
  - limiting before: —
  - limiting after: Черновая геометрия (stub): пешеходный доступ не по графу улиц — подтвердите на месте. | Дальние якоря частично ослаблены из‑за барьеров между точкой и объектом (barrier_penalty_applied).
- **showroom** medium → medium
  - limiting before: —
  - limiting after: Черновая геометрия (stub): пешеходный доступ не по графу улиц — подтвердите на месте. | Дальние якоря частично ослаблены из‑за барьеров между точкой и объектом (barrier_penalty_applied).
- **destination_venue** medium → medium
  - limiting before: Нет мощного якоря — catchment-зона ограничена
  - limiting after: Нет мощного якоря — catchment-зона ограничена | Черновая геометрия (stub): пешеходный доступ не по графу улиц — подтвердите на месте. | Дальние якоря частично ослаблены из‑за барьеров между точкой и объектом (barrier_penalty_applied).

### lyubertsy_center — Центр Люберец, Подмосковье

**Классификация:** mixed (verdict weak→weak; primary(convenience) low→low; human critical 0→0; spatial penalty false→true)

| Поле | Before (SF off) | After (SF on) |
|------|-------------------|---------------|
| Вердикт | weak (Слабый потенциал — высокий риск) | weak (Слабый потенциал — высокий риск) |
| Spatial tier | stub enabled=false | stub enabled=true |
| barrier_penalty | false (0 magnets) | true (7) |
| Barriers (report‑style) | Промышленная инфраструктура снижает потребительский контекст | Промышленная инфраструктура снижает потребительский контекст |

**Format fit (limiting factors — только если отличаются):**

- **retail** poor → poor
  - limiting before: Слишком слабый спрос или промышленные барьеры | Промышленное окружение — сдерживает потребительский поток
  - limiting after: Слишком слабый спрос или промышленные барьеры | Промышленное окружение — сдерживает потребительский поток | Черновая геометрия (stub): пешеходный доступ не по графу улиц — подтвердите на месте. | Дальние якоря частично ослаблены из‑за барьеров между точкой и объектом (barrier_penalty_applied).
- **food_beverage** poor → poor
  - limiting before: Недостаточно проходимости для F&B без особой концепции | Промышленное окружение не формирует аудиторию F&B
  - limiting after: Недостаточно проходимости для F&B без особой концепции | Промышленное окружение не формирует аудиторию F&B | Черновая геометрия (stub): пешеходный доступ не по графу улиц — подтвердите на месте. | Дальние якоря частично ослаблены из‑за барьеров между точкой и объектом (barrier_penalty_applied).
- **service** low → low
  - limiting before: Промышленное окружение снижает сервисный спрос
  - limiting after: Промышленное окружение снижает сервисный спрос | Черновая геометрия (stub): пешеходный доступ не по графу улиц — подтвердите на месте. | Дальние якоря частично ослаблены из‑за барьеров между точкой и объектом (barrier_penalty_applied).
- **convenience** low → low
  - limiting before: Слабая транзитная или локальная база | Промышленное окружение — мало жилой / рабочей аудитории рядом
  - limiting after: Слабая транзитная или локальная база | Промышленное окружение — мало жилой / рабочей аудитории рядом | Черновая геометрия (stub): пешеходный доступ не по графу улиц — подтвердите на месте. | Дальние якоря частично ослаблены из‑за барьеров между точкой и объектом (barrier_penalty_applied).
- **showroom** low → low
  - limiting before: Промышленное окружение создаёт барьер восприятия бренда
  - limiting after: Промышленное окружение создаёт барьер восприятия бренда | Черновая геометрия (stub): пешеходный доступ не по графу улиц — подтвердите на месте. | Дальние якоря частично ослаблены из‑за барьеров между точкой и объектом (barrier_penalty_applied).
- **destination_venue** low → low
  - limiting before: Destination-формат требует мощных якорей или исключительной концепции | Промышленное окружение несовместимо с destination-концепцией
  - limiting after: Destination-формат требует мощных якорей или исключительной концепции | Промышленное окружение несовместимо с destination-концепцией | Черновая геометрия (stub): пешеходный доступ не по графу улиц — подтвердите на месте. | Дальние якоря частично ослаблены из‑за барьеров между точкой и объектом (barrier_penalty_applied).

### elektrozavodskaya_moscow
**Ошибка:** elektrozavodskaya_moscow: timed out after 120000ms

### pokrovskoye_streshnevo — Покровское-Стрешнево, Москва

**Классификация:** mixed (verdict weak→weak; primary(service) medium→medium; human critical 0→0; spatial penalty false→false)

| Поле | Before (SF off) | After (SF on) |
|------|-------------------|---------------|
| Вердикт | weak (Слабый потенциал — высокий риск) | weak (Слабый потенциал — высокий риск) |
| Spatial tier | stub enabled=false | stub enabled=true |
| barrier_penalty | false (0 magnets) | false (0) |
| Barriers (report‑style) | — | — |

**Format fit (limiting factors — только если отличаются):**

- **retail** low → low
  - limiting before: Слабый индекс локации
  - limiting after: Слабый индекс локации | Черновая геометрия (stub): пешеходный доступ не по графу улиц — подтвердите на месте.
- **food_beverage** low → low
  - limiting before: Слабый общий индекс локации
  - limiting after: Слабый общий индекс локации | Черновая геометрия (stub): пешеходный доступ не по графу улиц — подтвердите на месте.
- **service** medium → medium
  - limiting before: —
  - limiting after: Черновая геометрия (stub): пешеходный доступ не по графу улиц — подтвердите на месте.
- **convenience** medium → medium
  - limiting before: —
  - limiting after: Черновая геометрия (stub): пешеходный доступ не по графу улиц — подтвердите на месте.
- **showroom** low → low
  - limiting before: Нет метро / ж/д рядом — сложнее добраться | Слабый индекс — низкий целенаправленный трафик
  - limiting after: Нет метро / ж/д рядом — сложнее добраться | Слабый индекс — низкий целенаправленный трафик | Черновая геометрия (stub): пешеходный доступ не по графу улиц — подтвердите на месте.
- **destination_venue** low → low
  - limiting before: Слабый индекс — нет достаточного внешнего спроса | Ограниченная транспортная доступность | Destination-формат требует мощных якорей или исключительной концепции
  - limiting after: Слабый индекс — нет достаточного внешнего спроса | Ограниченная транспортная доступность | Destination-формат требует мощных якорей или исключительной концепции | Черновая геометрия (stub): пешеходный доступ не по графу улиц — подтвердите на месте.

### khamovniki_moscow — Хамовники (жилой), Москва

**Классификация:** mixed (verdict strong→strong; primary(service) medium→medium; human critical 2→2; spatial penalty false→true)

| Поле | Before (SF off) | After (SF on) |
|------|-------------------|---------------|
| Вердикт | strong (Сильная коммерческая точка) | strong (Сильная коммерческая точка) |
| Spatial tier | stub enabled=false | stub enabled=true |
| barrier_penalty | false (0 magnets) | true (3) |
| Barriers (report‑style) | Промышленная инфраструктура снижает потребительский контекст | Промышленная инфраструктура снижает потребительский контекст |

**Format fit (limiting factors — только если отличаются):**

- **retail** high → high
  - limiting before: —
  - limiting after: Черновая геометрия (stub): пешеходный доступ не по графу улиц — подтвердите на месте. | Дальние якоря частично ослаблены из‑за барьеров между точкой и объектом (barrier_penalty_applied).
- **food_beverage** high → high
  - limiting before: —
  - limiting after: Черновая геометрия (stub): пешеходный доступ не по графу улиц — подтвердите на месте. | Дальние якоря частично ослаблены из‑за барьеров между точкой и объектом (barrier_penalty_applied).
- **service** medium → medium
  - limiting before: —
  - limiting after: Черновая геометрия (stub): пешеходный доступ не по графу улиц — подтвердите на месте. | Дальние якоря частично ослаблены из‑за барьеров между точкой и объектом (barrier_penalty_applied).
- **convenience** high → high
  - limiting before: —
  - limiting after: Черновая геометрия (stub): пешеходный доступ не по графу улиц — подтвердите на месте. | Дальние якоря частично ослаблены из‑за барьеров между точкой и объектом (barrier_penalty_applied).
- **showroom** high → high
  - limiting before: —
  - limiting after: Черновая геометрия (stub): пешеходный доступ не по графу улиц — подтвердите на месте. | Дальние якоря частично ослаблены из‑за барьеров между точкой и объектом (barrier_penalty_applied).
- **destination_venue** medium → medium
  - limiting before: —
  - limiting after: Черновая геометрия (stub): пешеходный доступ не по графу улиц — подтвердите на месте. | Дальние якоря частично ослаблены из‑за барьеров между точкой и объектом (barrier_penalty_applied).

### gorky_park_moscow — Парк Горького, Москва

**Классификация:** improved (verdict strong→strong; primary(food_beverage) high→high; human critical 2→1; spatial penalty false→true)

| Поле | Before (SF off) | After (SF on) |
|------|-------------------|---------------|
| Вердикт | strong (Сильная коммерческая точка) | strong (Сильная коммерческая точка) |
| Spatial tier | stub enabled=false | stub enabled=true |
| barrier_penalty | false (0 magnets) | true (10) |
| Barriers (report‑style) | Промышленная инфраструктура снижает потребительский контекст | Промышленная инфраструктура снижает потребительский контекст |

**Format fit (limiting factors — только если отличаются):**

- **retail** high → high
  - limiting before: —
  - limiting after: Черновая геометрия (stub): пешеходный доступ не по графу улиц — подтвердите на месте. | Дальние якоря частично ослаблены из‑за барьеров между точкой и объектом (barrier_penalty_applied).
- **food_beverage** high → high
  - limiting before: —
  - limiting after: Черновая геометрия (stub): пешеходный доступ не по графу улиц — подтвердите на месте. | Дальние якоря частично ослаблены из‑за барьеров между точкой и объектом (barrier_penalty_applied).
- **service** medium → medium
  - limiting before: —
  - limiting after: Черновая геометрия (stub): пешеходный доступ не по графу улиц — подтвердите на месте. | Дальние якоря частично ослаблены из‑за барьеров между точкой и объектом (barrier_penalty_applied).
- **convenience** high → medium
  - limiting before: —
  - limiting after: Туристическая аудитория не формирует стабильный повседневный спрос | Черновая геометрия (stub): пешеходный доступ не по графу улиц — подтвердите на месте. | Дальние якоря частично ослаблены из‑за барьеров между точкой и объектом (barrier_penalty_applied).
- **showroom** high → low
  - limiting before: —
  - limiting after: Туристический поток не конвертируется в аудиторию шоурума | Черновая геометрия (stub): пешеходный доступ не по графу улиц — подтвердите на месте. | Дальние якоря частично ослаблены из‑за барьеров между точкой и объектом (barrier_penalty_applied).
- **destination_venue** medium → high
  - limiting before: —
  - limiting after: Черновая геометрия (stub): пешеходный доступ не по графу улиц — подтвердите на месте. | Дальние якоря частично ослаблены из‑за барьеров между точкой и объектом (barrier_penalty_applied).

---

## 4. Выводы (кратко)

- **Product jump?** Скорее **нет**: на доступной девятке v1 в основном добавляет **объяснимость** (stub‑дисклеймер, dampening дальних магнитов), а **уровни** format‑fit меняет точечно (один кейс). Это не перелом sellable‑качества всего commercial core.
- **Пять кейсов, которые «улучшились сильнее всего»:** в данных этого прогона **один** явный кандидат — `gorky_park_moscow`. Ещё четыре «сильнейших» в смысле продукта **не выделяются** (нет сдвига `fitMap`). При полной матрице пересмотрите ранжирование после повторного fetch.
- **Главный spatial gap до Phase 2:** tier **`stub`** — нет графа улиц и маршрутизации пешехода; барьеры и коридор — упрощённые OSM‑прокси, без реальной walkability, входных групп, пересадок и времени в пути.
- **Sellable commercial V1:** v1 **чуть** приближает core к продаже за счёт честного сигнала «дальние якоря могут быть геометрически слабее», но **не** закрывает системные зазоры format‑fit (туризм vs convenience, destination share и т.д.). Для sellable V1 нужны стабильные данные + Phase 2 geometry + отдельный тюнинг правил format‑fit.
