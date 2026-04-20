# Итог: готовность платформы к ~90% (честный вывод)

## 1. Какие модули реально можно довести до ~90% на текущем data stack

| Модуль | Комментарий |
|--------|-------------|
| **Communication** | Уже близок: сильные тесты, orchestrator, ops/payments связи. 90% достижим при дисциплине данных (резервации, knowledge source) **без** новых внешних глобальных датасетов. |
| **Location / Residential core** | Достижимо **~85–90%** как «OSM+геокод+эвристики» с жёсткой политикой uncertainty и validation loop. |
| **Ops / Autonomy core** | Достижимо **~80–88%** как policy engine при расширении incident control set и связке с реальными статусами объектов. |

## 2. Какие модули упрются в data ceiling

| Модуль | Потолок |
|--------|---------|
| **Location / Commercial** | Footfall, внутри-квартальная пешеходная сеть, «тихие» магниты без OSM — без внешних слоёв не закрыть полностью. |
| **Pricing / Revenue** | Без рыночных компов/ставок любая модель — **proxy**; честный потолок ~60–70% без провайдера. |
| **Location Residential** (revenue block в отчёте) | Даже при сильном core, **денежные** выводы упираются в market data. |

## 3. Где нужны внешние data layers / providers

- **Market comps / ADR / occupancy** — внешний агрегатор или партнёрский feed (см. roadmap Pricing).  
- **Footfall / mobility** — telco/WiFi/навигационные данные или агрегаторы аналитики торговых улиц.  
- **Commercial corridor graph** — опционально: платный routing/isochrone provider при нежелании поддерживать собственный граф.  
- **Finance** — налоговые правила по странам (внешние консультанты/сервисы), не только код.

## 4. Что можно честно обещать пользователям (сейчас)

- **Location (residential)**: «Локационный разбор на основе открытых карт и методологии притяжения с явными ограничениями по полноте данных».  
- **Location (commercial) pilot**: «Формат-фит и потоки как **ориентир** для пилота; геометрия улиц и барьеров — в развитии (tier будет указан)».  
- **Communication**: «Автоматизация сообщений гостя с эскалацией к человеку; поддержка нескольких каналов; аудит ключевых шагов» — **при** подключённых реальных данных объекта/брони.

## 5. Что только beta / pilot / proxy

- Любые **абсолютные** прогнозы выручки без market provider.  
- **Commercial micro-catchment** до появления graph/provider tier.  
- **Finance / ledger** — вся область до реализации журнала.  
- **Unified platform orchestration** — до `PlatformDecision` и политики приоритетов.

## 6. Сколько workstreams осталось до ~90% (порядок величины)

Модуль | Оставшихся workstreams (из roadmap) | Примечание |
--------|-------------------------------------|------------|
| Location Residential | **6** | Больше половины — validation + meta/provenance. |
| Location Commercial | **7** | Самый тяжёлый блок — spatial + external optional. |
| Communication | **5** | В основном качество данных и матрица кейсов. |
| Pricing / Revenue | **6+** | Сильно зависит от внешнего feed. |
| Ops / Autonomy | **5** | Политики + данные инцидентов. |
| Finance / Ledger | **8+** | Модуль с нуля. |
| Cross-module | **4** | После стабилизации доменов. |

---

## Главный bottleneck сейчас

**Location / Commercial-Retail — core spatial layer** (micro-catchment, коридор, барьеры, согласованность с картой/вердиктом). Это узкое место **всей** narrative «AI location для retail», тормозит честную sellable позицию и создаёт максимальный репутационный разрыв.

## Что делать первым

1. **Wave 1 — Задача 1** (spatial foundation v1 + `spatial_tier` + барьеры).  
2. Параллельно **Wave 1 — Задача 3** (knowledge provenance) как быстрый risk reduction.  
3. **Wave 1 — Задача 2** (единый validation runner) как merge gate.

## Что быстрее всего приблизить к ~90%

1. **Communication** (меньше всего внешних зависимостей для «логики решений»).  
2. **Ops decision-engine** при расширении тестовых кейсов.  
3. **Residential location core** при фокусе на validation + uncertainty, не на новых датасетах.

## Honest target % (достижимый на горизонте 1–2 циклов разработки)

Модуль | Demo | Standalone | Core | Комментарий |
--------|------|------------|------|-------------|
| Location Residential | 75–82% | 68–76% | 78–88% | Выше при сильном validation loop. |
| Location Commercial | 62–70% | 58–68% | 55–70% | Верхняя граница без footfall provider. |
| Communication | 82–88% | 72–80% | 74–82% | |
| Pricing / Revenue | 45% | 35–45% | 30–45% | Без market feed — ниже 70% честно не тянуть. |
| Ops / Autonomy | 55% | 58–68% | 65–78% | |
| Finance / Ledger | 20% | 25–40% | 15–35% | После v1 ledger — пересмотр. |
| Cross-module orchestration | 50% | 45–55% | 48–60% | После schema v0 — рост. |

---

Документы-основа: `platform-90-percent-readiness-framework.md`, `platform-module-readiness-audit.md`, `platform-90-percent-roadmap.md`, `platform-validation-loop-plan.md`, `platform-wave-1-execution-plan.md`.
