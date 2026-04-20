# Commercial V1 — Readiness Assessment (Honest)
**Дата:** 2026-04-19  
**Цель:** Честно оценить, насколько commercial ветка готова как: (a) MVP, (b) sellable standalone product, (c) near-production decision engine.  
**Ограничение:** Оценка основана на текущей архитектуре OSM-only + proxy flow. Нельзя приписывать точность, которой нет.

---

## 1) Что уже можно считать finished-level (в рамках OSM-only V1)

### 1.1 Commercial format-fit как продуктовый блок (после Fix Pass 1–2)
**Сильные стороны:**
- Transit hubs → **convenience** (стабильно, логика правдоподобна).
- Business hubs → **service / showroom** (стабильно).
- Tourist destinations → **destination venue** + showroom не всплывает (после Fix 2) — стало сильно лучше.
- True industrial → честная блокировка (не “высосать вывод” там, где его нет).

**Почему это finished-level (V1):**
- Выводы интерпретируемы и объяснимы.
- Сигналы опираются на наблюдаемую структуру POI/anchors, не на “магическую цифру”.

### 1.2 Коммерческий отчёт как отдельный permalink-flow
**Сильные стороны:**
- Отдельный коммерческий флоу уже выведен на фронт.
- Есть standalone report с permalink — это уже “продуктовый контур”.

---

## 2) Что остаётся proxy (и это нормально, если честно упаковать)

### 2.1 Flow shares (transit/local/destination)
- **Статус:** proxy по структуре магнитов и их типам.
- **Риск:** пользователь может прочитать как “точные проценты людей”.
- **Митигировать:** в UI/отчёте маркировать как proxy и давать narrative (“commuter-led”, “tourism-led”).

### 2.2 Competition snapshot
- **Статус:** proxy (OSM coverage bias).
- **Риск:** “конкурентов мало” может быть ложью.
- **Митигировать:** показывать как qualitative density, плюс site-visit checks.

### 2.3 Spatial map (текущая реализация)
- **Статус:** сейчас больше “POI heatmap”, чем “commercial spatial structure”.
- **Риск:** визуально выглядит как “ещё одна карта с точками”.
- **Митигировать:** реализовать план `docs/commercial-spatial-map-v1-plan.md` (rings / layers / barriers / corridors).

---

## 3) Что требует external data layer (Phase 2) и без чего нельзя обещать near-production

### 3.1 Реальный pedestrian footfall
- Нужен mobility feed или POI visit counts.
- Без этого нельзя обещать “сколько людей у двери” и нельзя честно калибровать micro-catchment intensity.

### 3.2 Реальный routing / walkability / barrier обход
- Нужны routing engines (OSRM/Valhalla) + корректная геометрия + возможно elevation.
- OSM теги дают барьеры, но не дают реальную “временную” доступность.

### 3.3 Vehicle traffic / stopping behavior
- Для auto-corridors (showrooms, roadside retail) нужны внешние данные о трафике и парковках.

---

## 4) Readiness по workstreams (что реально закрыто этим этапом)

### Workstream 1 — Expanded validation
- **Статус:** ✅ документ есть (`docs/commercial-v1-expanded-validation.md`, 50 кейсов).
- **Остаточный риск:** это аналитическая валидация по архетипам; без автоматических прогонов часть кейсов остаётся “ожидаемым выводом”.

### Workstream 2 — Format-fit V1 tuning plan
- **Статус:** ✅ документ есть (`docs/commercial-format-fit-v1-tuning-plan.md`).
- **Остаточный риск:** план требует внедрения в код и повторной проверки на контрольном наборе.

### Workstream 3 — Micro-catchment + corridor logic
- **Статус:** ✅ spec + mvp-plan есть (`docs/commercial-micro-catchment-spec.md`, `docs/commercial-micro-catchment-mvp-plan.md`).
- **Остаточный риск:** это пока архитектура/план, а не реализованный слой в проде.

### Workstream 4 — Spatial map V1 plan
- **Статус:** ✅ план есть (`docs/commercial-spatial-map-v1-plan.md`).
- **Остаточный риск:** не реализовано → продукт визуально всё ещё может выглядеть как “калькулятор”.

### Workstream 5 — Commercial report V1 spec
- **Статус:** ✅ сделано (`docs/commercial-report-v1-spec.md`).
- **Остаточный риск:** спецификация должна быть доведена до UI-реализации (блоки, disclaimers, checklist).

### Workstream 6 — Public packaging
- **Статус:** ✅ сделано (`docs/commercial-product-positioning-v1.md`).
- **Остаточный риск:** нужно внедрить copy на entry screen и в onboarding.

### Workstream 7 — Readiness assessment
- **Статус:** ✅ этот документ.

---

## 5) Честная оценка готовности (проценты)

Ниже проценты — не “сколько осталось строк кода”, а насколько продукт готов к внешнему использованию.

### 5.1 Как MVP
- **Оценка:** **75–85%**
- **Почему не 95%:** есть устойчивые выводы, но остаются явные failure modes (service в residential, destination пороги, showroom в premium+tourist), плюс карта/репорт ещё не дают spatial advantage визуально.

### 5.2 Как sellable standalone product (V1, OSM-only)
- **Оценка:** **60–70%**
- **Что мешает продажности:**
  - micro-catchment и commercial spatial map пока в планах, а это главный “product jump”.
  - report V1 spec есть, но нужна реализация блоков (особенно site-visit checklist + honesty UX).
  - несколько известных edge-case логик требуют pass 3/4 внедрения.

### 5.3 Как near-production decision engine
- **Оценка:** **35–50%**
- **Причина:** без external mobility/routing/traffic данных нельзя честно обещать уровень точности, который ожидают “near-production” клиенты.

---

## 6) Можно ли честно говорить “почти готово”?

### “Почти готово” — только если уточнить рамку
Честная публичная формулировка:
- **“Commercial V1 (OSM-only) готов для пилотных клиентов и продаж как pre-site-visit инструмент. Для near-production точности нужен Phase 2 с mobility data.”**

### Можно ли говорить “90–95%”?
- **Нет**, это будет натяжка в текущей стадии, потому что:
  - ключевой продуктовый скачок (micro-catchment + corridor + barriers + коммерческая карта) пока не реализован,
  - часть format-fit edge cases ещё требует внедрения правок,
  - отсутствие external data системно ограничивает точность.

---

## 7) Следующие 3 шага, которые реально поднимут sellable readiness

1) **Внедрить Pass 3 из tuning plan** (service guard + destination thresholds + tourist F&B) и перепроверить контрольный набор.  
2) **Реализовать micro-catchment MVP слой** (position label + barriers + anchor directions) и вывести в отчёт.  
3) **Сделать commercial map V1** (rings + multi-layer heat + barriers overlay) — это ключ к “не калькулятору”.

