# Location Model — Tuning Plan (на основе 100-кейсовой валидации)

> Документ: аналитическая бумага, не код. Все рекомендации опираются на реальные результаты валидации.
> Источник: `docs/location-validation-100-cards.md`, `docs/location-validation-summary-ru.md`

---

## 1. Ключевые симптомы модели

| Симптом | Масштаб | Кейсов затронуто |
|---------|---------|-----------------|
| Ceiling effect (idx=100) | критический | 33/100 (33%) |
| OSM metro-мисматч (Азия, СНГ) | критический | ~15/100 |
| Airport radius 3500м — ложные positives | критический | ~8/100 |
| Competitor pressure уничтожает tourist hubs | критический | ~10/100 |
| Office noise (раздувание business-кластеров) | средний | ~12/100 |
| Sparse OSM — развивающиеся рынки | средний | ~10/100 |
| Ski/resort slippage | средний | 5/100 |
| Нет дифференциации strong/strong | некритичный | ~16/100 |

---

## 2. Главные причины (root causes)

### RC1 — Отсутствие верхней нормировки
`rawScore` растёт неограниченно; `Math.min(100, rawScore)` только сверху, нет нормировки.
При attraction=260+ любая metropolitan-зона = 100. Times Square = Переславль.

### RC2 — Airport radius 3500м без условий
`CATEGORY_RADIUS.airport = 3500` — радиус взят для «жители в зоне притяжения аэропорта», но применяется как радиус поиска магнита. Любая точка в 3.5км от Vnukovo, JFK, CDG получает вес 8.
**Симптом:** Ozone Park, Tromsø, Mykonos, Beaune — все strong из-за аэропорта.
**Обратная сторона:** сам аэропорт (Frank Airport vicinity) = weak/20, потому что координата поставлена не рядом с терминалом.

### RC3 — railway=subway_entrance как единственный metro-детектор
HK MTR использует `railway=station` + `station=subway` без subway_entrance.
Stockholm T-Bana: входы tagged как `railway=station`, не subway_entrance.
Medellín Metro: `railway=station` без subway.
Казань Метро: может быть tagged как `railway=station`.
**Симптом:** idx=6 для Causeway Bay, idx=5 для Казани.

### RC4 — competitorPressureMax=20 как жёсткий потолок
Формула: `Math.min(p*dm, 20)`. При 50+ конкурентах в радиусе (Siena=100, El Poblado=74, Covent Garden=106) давление = всегда 20.
Сильные tourist-heavy локации стабильно получают -20 к базовому score, что убивает их, если baseAttraction низкий.

### RC5 — business category = все OSM-офисы
`office` tag в OSM захватывает нотариусов, бухгалтеров, страховых агентов, консульства. В странах с хорошей OSM-деловой картографией (DE, ES, RU) business count = 100–500+ объектов.
`effectiveBusinessWeight('office_anon') = weight * 0.45` снижает, но в кластере из 8+ офисов это всё равно даёт clusterBonus=8.

### RC6 — isMajorHotel = luxury chain OR stars≥4
Азиатские luxury chains (Anantara, Shangri-La, Minor Hotels, Rixos) не в списке `LUXURY_CHAINS`.
Латиноамериканские chain (Dann, GHL, Fiesta Inn) отсутствуют.
Российские sochi-отели не имеют stars в OSM.
**Симптом:** Pattaya=31, Copacabana=36, Красная Поляна=5.

---

## 3. Разбор ключевых аномалий

### #8 — Causeway Bay Hong Kong (weak/6, ожидалось strong)
- **Ошибка:** OSM-мисматч. `hasMetro=false`, 0 metro-магнитов при 320 элементах.
- **Причина:** логика, не данные. MTR тегировано иначе.
- **Слой:** classifyElement → `railway=subway_entrance OR station=subway`; нужно добавить `railway=station` + `station=subway`.
- **Фикс:** добавить `t.station === 'subway'` (уже есть, но HK MTR теги: `railway=station`, `network=MTR`). Добавить `t.network?.includes('MTR')` как fallback.

### #63 — Казань центр (weak/5, ожидалось strong)
- **Ошибка:** 0 metro, 0 attraction, только food. 91 элемент в данных, всё food.
- **Причина:** совмещение OSM-мисматча + конкурентное давление.
- **Слой:** classifyElement — казанское метро, возможно, `railway=station` без subway тега.
- **Фикс:** те же исправления metro + добавить `t.historic` в attraction classifier.

### #20 — Ozone Park (strong/100, ожидалось weak)
- **Ошибка:** Airport radius 3500м захватывает JFK + 6 metro AirTrain-линий.
- **Причина:** логика (radius). Не проблема данных.
- **Слой:** CATEGORY_RADIUS.airport = 3500 → слишком большой.
- **Фикс:** снизить до 1800–2000м ИЛИ добавить penalty: если airport — единственный сильный магнит и нет других топ-5, не давать полный вес.

### #47 — Tromsø (strong/100, ожидалось medium)
- **Ошибка:** 3 airport в радиусе 3500м (местный аэропорт Tromsø + 2 nearby heliports?). В `magnetCountByCategory.airport=3`, вес 8 × 3 = 24.
- **Причина:** airport radius bug.
- **Фикс:** то же, что #20.

### #44 — Siena (weak/5, ожидалось medium)
- **Ошибка:** 191 food, 100 конкурентов = maxPressure. 0 attraction.
- **Причина:** классификация. `tourism=attraction` в OSM Сиены — нулевой count; исторические церкви/palazzo тегированы как `historic=church`, `historic=building`, не как `tourism=attraction`.
- **Слой:** classifyElement — нужно добавить `t.historic` расширение.
- **Фикс:** добавить в attraction classifier: `t.historic === 'church' || t.historic === 'building' || t.historic === 'palace' || t.historic === 'castle'`.

### #45 — Переславль-Залесский (strong/100, ожидалось weak)
- **Ошибка:** 45 офисных POI (нотариусы, страховые, МФЦ) при кластере 9 магнитов = clusterBonus=8.
- **Причина:** office noise. `effectiveBusinessWeight('office')` = полный вес 5.5, не снижен.
- **Слой:** effectiveBusinessWeight — `office` (named) получает полный вес. Нужно снизить для мелких провинциальных офисов.
- **Фикс:** ввести geo-aware весовой мультипликатор ИЛИ снизить `office` (named) с 5.5 до 3.5–4.0.

### #54 — Wedding Berlin (strong/100, ожидалось weak)
- **Ошибка:** 41 metro-станция в радиусе 1200м (стандартный metro CATEGORY_RADIUS). Berlin S/U-Bahn очень плотный.
- **Причина:** metro inflation. Берлин — 9 линий U-Bahn + S-Bahn в плотной сети.
- **Слой:** CATEGORY_MAX_SHOW.metro=3 уже ограничивает показ, но не влияет на clusterBonus: все 41 станция участвуют в `magnetCountByCategory`.
- **Фикс:** ограничить `magnets` для cluster calculation по `CATEGORY_MAX_SHOW`, не по raw count.

### #55, #44 — El Poblado + Siena + Quartieri Spagnoli (weak/5, ожидалось medium)
- **Ошибка:** competitor pressure = 20 при 50–100 конкурентах. Базовая привлекательность низкая (нет сильных магнитов).
- **Причина:** competitorPressure как hard ceiling 20 — слишком агрессивен для tourist-heavy зон.
- **Слой:** calcCompetitorPressure — `Math.min(p*dm, 20)`.
- **Фикс:** снизить competitorPressureMax с 20 до 14–16 ИЛИ сделать его функцией от base attraction (если attraction >> competitors, давление меньше).

### #84 — Brickell Miami (weak/32, ожидалось strong)
- **Ошибка:** 16 элементов total; metro в 910–988м (за пределами эффективного decay).
- **Причина:** sparse OSM + metro слишком далеко.
- **Слой:** данные, не логика.
- **Фикс:** только улучшение OSM-данных; модель работает правильно при наличии данных.

### #70 — Сочи центр (weak/22, ожидалось medium)
- **Ошибка:** 5 attractions, 8 конкурентов; 0 major_hotels (Marriott Sochi не тегирован).
- **Причина:** isMajorHotel не захватывает российские luxury.
- **Слой:** LUXURY_CHAINS — отсутствуют Radisson Blu (есть Radisson), Azimut есть, Sochi Marriott может быть без тега.
- **Фикс:** добавить `stars>=4` fallback (уже есть!) → проверить, есть ли stars-тег в Сочи.

---

## 4. Что подкрутить в первую очередь (Quick Wins)

### QW1 — Airport radius: 3500м → 2000м
**Файл:** `src/lib/location/config.ts` → `CATEGORY_RADIUS.airport`
**Эффект:** исправит Ozone Park (100→weak), Tromsø (100→medium/strong), Beaune (52→low-medium), Mykonos (останется strong, но ниже)
**Риск:** может занизить хабы типа King's Cross (нет, там metro dominant)
**Уровень сложности:** 1 строка

### QW2 — Metro classifier: добавить station=subway и расширенные паттерны
**Файл:** `src/lib/location/overpass.ts` → `classifyElement`
Добавить условие: `t.railway === 'station' && (t.station === 'subway' || t.subway === 'yes')`
**Эффект:** исправит HK MTR → Causeway Bay (6→60+), потенциально Казань, Алматы
**Риск:** ложные positives для обычных ж/д станций → проверить `t.station === 'subway'` как обязательное условие
**Уровень сложности:** 3–5 строк

### QW3 — Historic attractions: расширить classifyElement
**Файл:** `src/lib/location/overpass.ts`
Добавить: `t.historic === 'castle' || t.historic === 'church' || t.historic === 'palace' || t.historic === 'monastery'`
**Эффект:** исправит Siena, Quartieri Spagnoli, Baku, Казань (кремль)
**Риск:** пустые `name` для мелких historic объектов — добавить проверку `t.name`
**Уровень сложности:** 5–8 строк

### QW4 — competitorPressureMax: 20 → 15
**Файл:** `src/lib/location/config.ts` → `GRAVITY_CONFIG.competitorPressureMax`
**Эффект:** ослабит наказание для dense tourist zones; +5 очков для Siena, El Poblado и др.
**Риск:** может завысить конкурентно насыщенные зоны с реально слабой привлекательностью
**Уровень сложности:** 1 строка

### QW5 — LUXURY_CHAINS: добавить азиатские и ЛА-бренды
**Файл:** `src/lib/location/overpass.ts` → `LUXURY_CHAINS`
Добавить: `'anantara', 'banyan tree', 'mandarin', 'rixos', 'dana', 'orient express', 'minor', 'rotana', 'jumeirah', 'emaar', 'dann', 'ghm', 'fiesta inn', 'camino real'`
**Эффект:** исправит Pattaya, Copacabana частично, Сочи частично
**Уровень сложности:** 1 строка

---

## 5. Что подкрутить во вторую очередь (Medium Effort)

### ME1 — Разжать шкалу: логарифмическая нормировка вместо hard cap 100
**Текущая логика:** `Math.max(5, Math.min(100, rawScore))`
**Предложение:** ввести нормировку `idx = 100 * (rawScore / (rawScore + NORMALIZATION_BASE))`, где `NORMALIZATION_BASE ≈ 80–100`.
При rawScore=100 → idx≈50; при rawScore=200 → idx≈67; при rawScore=400 → idx≈80; при rawScore=1000+ → idx≈91.
**Эффект:** разожмёт верхнюю часть шкалы; Times Square и Ozone Park получат разные индексы
**Риск:** полный пересчёт всех threshold'ов (strong ≥70 → нужно пересмотреть)
**Уровень сложности:** средний (код + пересчёт calibration)

### ME2 — Office noise reduction: снизить вес named office
**Текущий вес:** `office` (named) = 5.5
**Предложение:** `office_named` → 3.0; только `office` с `name` в списке enterprise-паттернов → полный вес
**Эффект:** исправит Wedding Berlin, Переславль, Prenzlauer Berg
**Уровень сложности:** средний (нужно изменить effectiveBusinessWeight + добавить паттерн)

### ME3 — Cluster calc на основе CATEGORY_MAX_SHOW, не raw count
**Проблема:** clusterBonus рассчитывается по всем магнитам в `magnets` array, но если metro=41 поступают через `items.slice(0, 3)` (max_show=3), то в кластер идут только 3, но... нет, `calcClusterBonus` берёт `magnets` после slice. Нужно проверить точнее: в `buildAnalysis` `magnets` собирается через `items.slice(0, CATEGORY_MAX_SHOW)`. Это правильно. Проблема в другом — 3 metro-магнита рядом уже дают clusterSize≥3 + bonus.
**Предложение:** повысить `clusterMinMagnets` с 3 до 4 для clusterBonus.
**Уровень сложности:** 1 строка, но нужна калибровка

### ME4 — Competitor pressure: взвесить по proximity
**Текущая логика:** все конкуренты в радиусе 800м с decay.
**Предложение:** добавить фильтр — конкуренты в 200м < 50м весят ×1.5; конкуренты 200–500м — ×1.0; 500–800м — ×0.5. Это правдоподобнее реального рынка.
**Уровень сложности:** средний

---

## 6. Что НЕ трогать пока

- **scoreScale = 1.94** — хорошо откалиброван для средних кейсов; любое изменение требует полного пересчёта
- **distanceDecayRefDist = 520м** — работает правильно для пешеходного радиуса
- **foot traffic layer (boostCap=7.5)** — вклад мал, не влияет на аномалии
- **CATEGORY_RADIUS.metro = 1200м** — правдоподобен, проблема в classifyElement, не в радиусе
- **Веса Tier 1 (metro=9, airport=8, attraction=8, hospital=7)** — логика верная, проблема в том, что данные не заполняются, а не в весах
- **Competitor radius = 800м** — правдоподобен

---

## 7. Экологический / комфортный фактор

Из 100 кейсов модуль не учитывает:
- загазованность и шум (Beijing Chaoyang получил weak/25, но причина — не экология, а sparse data)
- перегруженность инфраструктуры (Taksim с 100 — при реальных пробках)
- crime rate (El Poblado Medellín — известен drug tourism, но модель не знает)

**Как интегрировать без внешних API:**
OSM содержит некоторые прокси-сигналы:
- `landuse=industrial` в пределах 500м → environmental penalty (-5)
- `aeroway=runway` в 1000м → noise penalty (-3)
- Dense `amenity=nightclub` (>5 в 300м) → noise/disturbance flag

**Рекомендация:** не добавлять в scoring напрямую — слишком много ложных сигналов. Добавить как **отдельный индикатор** в explanation layer: «Обнаружена промышленная зона в 400м» / «Рядом аэропорт: возможный авиационный шум».

---

## 8. Приоритетный список

### Топ-5 изменений делать следующими

| Приоритет | Изменение | Файл | Строк | Эффект |
|-----------|-----------|------|-------|--------|
| 1 | Airport radius 3500→2000м | `config.ts` | 1 | исправит 8+ ложных positives |
| 2 | Metro classifier: station=subway | `overpass.ts` | 5 | исправит Causeway Bay, Казань, Алматы |
| 3 | Historic attractions (castle, church, palace) | `overpass.ts` | 8 | исправит Siena, Baku, Quartieri Spagnoli |
| 4 | competitorPressureMax: 20→15 | `config.ts` | 1 | улучшит все tourist-dense зоны |
| 5 | LUXURY_CHAINS: +азиатские +ЛА | `overpass.ts` | 1 | улучшит beach/resort по всему миру |

### Топ-5 изменений делать позже (после калибровки)

| Причина | Изменение |
|---------|-----------|
| Требует пересчёта всех порогов | Нормировка шкалы (логарифм) |
| Риск undershooting центров СНГ | Office noise reduction |
| Нужна полная калибровка | clusterMinMagnets 3→4 |
| Сложная логика | Competitor pressure by proximity |
| Внешние данные | Экологический фактор |

---

## 9. Контрольный набор для повторной проверки (10 кейсов)

После любого изменения прогнать эти 10 кейсов как регрессионный тест:

| # | Кейс | Текущий idx | Ожидаемый диапазон после фикса |
|---|------|-------------|-------------------------------|
| 8 | Causeway Bay (HK) | 6 | 55–80 (после metro fix) |
| 20 | Ozone Park (Queens) | 100 | 30–50 (после airport fix) |
| 44 | Siena old town | 5 | 25–45 (после historic + competitor fix) |
| 47 | Tromsø | 100 | 55–75 (после airport fix) |
| 63 | Казань центр | 5 | 60–85 (после metro + historic fix) |
| 37 | Cannes Croisette | 73 | 70–80 (должен остаться strong) |
| 1 | Times Square | 100 | должен остаться 100 |
| 17 | Clapham Common | 64 | должен остаться medium |
| 41 | Courchevel 1850 | 24 | 20–35 (до ski fix, не должен расти) |
| 35 | Печатники (промзона) | 7 | должен остаться weak |
