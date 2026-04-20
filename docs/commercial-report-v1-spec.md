# Commercial Report V1 — Specification (Standalone Sellable)
**Дата:** 2026-04-19  
**Статус:** v1-spec  
**Цель:** Коммерческий отчёт, который продаёт **пространственное решение** (flow → intent → fit → catchment → barriers), а не “магическую цифру”, и честно маркирует proxy/ограничения.

---

## 0) Принципы (что делает отчёт “sellable”)

- **Decision tool, not calculator:** не “score”, а “как устроено место и для какого формата оно работает”.
- **Spatial-first:** точка как позиция на улице/коридоре, а не как “район”.
- **Format-first verdict:** вывод под выбранный формат, плюс “в каких форматах сильнее/слабее”.
- **Honesty-first:** всё, что не измерено, помечается как **proxy** + всегда есть “что проверить на site visit”.
- **Commercial-only:** никаких residential-объяснений, которые размывают продукт.

---

## 1) Входные данные и источники

### 1.1 Что реально считается сейчас (OSM-only)
- **Magnets / anchors** по категориям и радиусам (450–2000 м) с decay.
- **EvergreenIndex** (сводная “сила городской коммерческой среды”).
- **Flow shares** (transit / local / destination) — **proxy**, выводится из структуры магнитов.
- **Commercial format-fit** (retail / food / service / convenience / showroom / destination venue).
- **Competition proxy**: простые счётчики конкурентов/POI по категориям (на базе OSM).
- **Neighborhood environment** (в т.ч. industrial component) — proxy по OSM.

### 1.2 Что является proxy (обязательные маркировки)
- **Foot traffic**: не реальные подсчёты людей, а структурный proxy.
- **Corridors / catchment**: без внешних mobility/routing — это геометрия и OSM-теги, не реальные маршруты.
- **Competition**: неполный и шумный слой; отражает “видимую по OSM плотность”, не реальную выручку/поток.

### 1.3 Phase 2 (не в V1)
- Реальные pedestrian counts, visit density by POI, vehicle traffic, routing-изохроны, кадастровая плотность.

---

## 2) Структура отчёта (V1)

### Блок A. Executive summary (1 экран)
**Цель:** сразу дать человеку “можно/нельзя” и почему, без спора про цифры.

- **Verdict for chosen format:** `Strong / Mixed / Risky / Not recommended`
- **Why (3 bullets):** 3 главных драйвера + 1 главный риск.
- **Where it works / where it breaks:** 2–3 bullets.
- **Required site checks:** 3–5 пунктов.
- **Confidence:** `High / Medium / Low` (по полноте OSM + устойчивости сигналов).

### Блок B. Spatial position & local capture (micro-catchment)
**Цель:** показать позицию точки как “frontage + коридор + барьеры + входящие векторы”.

Секции:
- **Position label:** high-street / backstreet / transit-adjacent / pedestrian zone (proxy).
- **Local capture rings:** 50/100/250/500 м (proxy-структура).
- **Barriers & friction:** река/жд/магистраль/закрытые зоны (proxy).
- **Anchor pull directions:** сильнейшие anchors с дистанцией и направлением (proxy).

Примечание V1:
- До реализации micro-catchment в коде этот блок может отображаться как “Coming in Phase 1” с честным описанием и без выдуманных цифр.

### Блок C. Structure of flow (intent mix)
**Цель:** объяснить “какой поток” и почему формат может/не может работать.

- **Transit share (proxy):** что его создаёт (metro/rail/bus).
- **Local share (proxy):** что его создаёт (residential + local POI density).
- **Destination share (proxy):** что его создаёт (attractions/shopping_major/entertainment).
- **Flow narrative:** 2–3 предложения “какой тип аудитории” (commuter / tourists / office-led / mixed).

Обязательный disclaimer:
> Доли потока рассчитаны как структурный proxy по OpenStreetMap и не являются измеренным пешеходным трафиком.

### Блок D. Format fit matrix (V1)
**Цель:** дать честную “матрицу пригодности” по 6 форматам + объяснение, что двигает и что ломает.

Требования:
- На каждый формат: **Fit level** (HIGH/MED/LOW/POOR) + **Top drivers** + **False signals to ignore** + **Main risks**.
- **Chosen format spotlight**: выбранный формат раскрывается глубже: “почему да/нет”, “при каких условиях станет да”.

### Блок E. Anchors & demand generators
**Цель:** показать “что реально тянет поток” и на какой дистанции это работает.

- Top anchors (3–7): name/category/distance/strength.
- Anchor types: transit / destination / business / shopping.
- “Anchor overlap”: попадает ли точка в их зону (proxy-кольца).

### Блок F. Barriers, friction, and capture leaks
**Цель:** не обещать то, что ломается из-за геометрии и барьеров.

- Hard barriers (rail/water/motorway) + где они режут catchment.
- Soft friction (wide roads, auto-corridors) — “проходимость vs задерживаемость”.
- “Leakage”: куда утекает поток (если видим сильный anchor рядом, но позиция backstreet).

### Блок G. Competition snapshot (V1 proxy)
**Цель:** дать полезную картину без ложной точности.

- **Count by category** (в радиусах 250/500 м): competitors in chosen format + adjacent substitutes.
- **Density label:** low / medium / high (не числа как “давление рынка”, а понятная категоризация).
- **Interpretation:** “конкуренты как индикатор спроса” vs “конкуренты как saturation risk”.

Ограничение:
> Competition snapshot отражает видимые по OpenStreetMap POI и не гарантирует полноту/актуальность.

### Блок H. Risks & non-obvious failure modes
**Цель:** сделать отчёт честным и профессиональным.

Минимум 5 типовых рисков:
- туристический поток ≠ регулярный спрос
- транзитный поток ≠ задерживаемость (convenience vs retail)
- backstreet позиция режет walk-in
- барьер режет одну сторону catchment
- OSM coverage bias (мало POI в базе ≠ пустая улица)

### Блок I. Site visit checklist (обязательный)
**Цель:** превращать отчёт в actionable pre-visit tool.

Шаблон чеклиста:
- **Frontage/visibility:** видимость входа, угол/середина блока, вывески конкурентов
- **Pedestrian reality check:** где реально идут люди, где переходят дорогу
- **Barriers reality check:** можно ли перейти магистраль, где переход/мост
- **Demand confirmation:** офисы/учебные/туристические генераторы реально работают?
- **Competitive reality:** кто реально вокруг (OSM может не видеть)

### Блок J. Appendix (для power users)
- raw top magnets
- categories present / missing
- data-quality flags

---

## 3) Данные / поля, которые должен отдавать backend для Commercial Report V1

Минимальный контракт (V1):
- `commercial.formatFit`: 6 форматов с `fitLevel`, `drivers`, `risks`, `falseSignals`
- `flow`: proxy shares + narrative
- `anchors`: top anchors
- `competition`: counts + density labels
- `barriers`: (если micro-catchment внедрён) список barrier items
- `confidence`: high/medium/low + причины
- `siteVisitChecklist`: массив пунктов

Если micro-catchment ещё не реализован:
- Блок B/F показывается в режиме “planned”, без выдуманных метрик, с 2–3 честными bullets “что добавится в Phase 1”.

---

## 4) Отличие от residential report (must-have)

- Нет “уровня жизни/комфортности”.
- Нет “подойдёт для жизни”.
- Все рекомендации формулируются вокруг **форматов** и **спроса**.
- Отдельный тон: “pre-lease / pre-investment due diligence layer”.

---

## 5) Definition of Done (V1 report)

Отчёт V1 считается “sellable” если:
- Executive summary отвечает на “покупаю/не покупаю” за 30 секунд.
- В отчёте **нет магической цифры** как главного результата.
- Есть честная маркировка proxy + чеклист site visit.
- Для chosen format есть понятные условия успеха/провала.
- Клиент видит spatial structure: anchors → flow → catchment/barriers (пусть часть proxy).

