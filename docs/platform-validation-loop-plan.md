# План validation loop по модулям (control set, регрессия, pass/fail)

Цель: каждый модуль имеет **фиксированный control set**, правила **регрессии**, допустимые улучшения после tuning и формальное **принятие решения** о pass/fail.

Общие правила платформы:

- **Regression (fail release):** ломается инвариант безопасности; молчаливое изменение provenance (measured→proxy); необъяснимый сдиг score/вердикта на эталоне выше порога без записи в changelog конфига.
- **Acceptable improvement:** метрика улучшается на эталонах **и** не нарушает инварианты; изменения задокументированы; explainability согласован с UI.
- **Частота:** минимум **на каждый PR**, затрагивающий модуль; nightly полный прогон для тяжёлых скриптов (OSM).

---

## 1. Location / Residential

| Параметр | План |
|----------|------|
| **Control set** | 30–50 адресов: крупный город / спальный район / туристический кластер / слабый OSM / граница воды. Зафиксировать: geocode result, OSM element count, score band, top-3 drivers. |
| **Артефакты** | JSON снимки (как `scripts/validation-results.json`); версия `GRAVITY_CONFIG`. |
| **Частота** | CI: быстрый поднабор (10); weekly: полный. |
| **Regression** | Изменение score > **X** пунктов при неизменённом конфиге; пропажа секции «unknown» при пустом OSM. |
| **Acceptable improvement** | Сдвиг score внутри ±X при обновлении OSM **допустим**, если обновлён `osm_snapshot_date` и нет flip band без причины в changelog. |
| **Pass после tuning** | Все эталоны в допусках; explainability JSON содержит те же ключи; ручная выборка 5 кейсов подтверждает здравый смысл. |

---

## 2. Location / Commercial-Retail

| Параметр | План |
|----------|------|
| **Control set** | 20 локаций: ТЦ рядом, улица-витрина, «за барьером», внутри квартала без магнитов, mixed-use. Для каждого: `spatial_tier`, format-fit verdict, corridor distance sanity. |
| **Артефакты** | `scripts/commercial-format-fit-validation.ts` + расширенный JSON; будущий `spatial-layout.json` для синтетики. |
| **Частота** | На PR в `src/lib/location/*commercial*`; nightly при изменении Overpass queries. |
| **Regression** | Flip `high↔poor` для одного формата без изменения входных магнитов; несоответствие spatial_tier и текста вердикта. |
| **Acceptable improvement** | Уточнение distances при улучшении snap-to-street, если барьеры учтены и тесты барьеров зелёные. |
| **Pass** | Все форматы имеют explanation; spatial stub явно в UI/meta; 0 silent mismatches между core и standalone. |

---

## 3. Communication

| Параметр | План |
|----------|------|
| **Control set** | Фиксированные тексты RU/EN: greeting, issue, payment, ambiguous reservation, staff forward, emergency keywords. |
| **Артефакты** | Существующие `__tests__/*`; добавить golden JSON «expected route class» на уровне orchestrator. |
| **Частота** | Каждый PR (`npm test` или целевой suite). |
| **Regression** | Любое авто-создание платежа при unmatched; отсутствие эскалации на emergency; потеря idempotency. |
| **Acceptable improvement** | Уточнение формулировок ответа при том же `ProcessOutcome`. |
| **Pass** | Все golden маршруты совпали; audit record содержит обязательные поля для autonomous path. |

---

## 4. Pricing / Revenue

| Параметр | План |
|----------|------|
| **Control set** | Пока **не вводить числовой golden** до появления MarketProvider: вместо этого контрактные тесты «stub не маскируется как live». |
| **Частота** | После P1 из roadmap — weekly + на PR. |
| **Regression** | Любое отображение point estimate без диапазона в standalone. |
| **Pass** | provenance + interval на всех цифрах. |

---

## 5. Ops / Autonomy

| Параметр | План |
|----------|------|
| **Control set** | Матрица: incident type × severity × evidenceConfidence × guestTier (из `incident-test-harness` + расширение). |
| **Частота** | Каждый PR при изменении `ops/decision-engine.ts`. |
| **Regression** | Изменение `blockCheckin` для high-severity damage без записи в changelog политики. |
| **Pass** | Все ожидаемые поля `OpsDecisionResult` совпали; причины не пустые. |

---

## 6. Finance / Ledger

| Параметр | План |
|----------|------|
| **Control set** | После F1: журналы из фикстур webhooks (успех, дубликат, частичный refund). |
| **Regression** | Двойное начисление при повторном webhook id. |
| **Pass** | Idempotent journal hash; баланс сходится. |

---

## 7. Cross-module orchestration

| Параметр | План |
|----------|------|
| **Control set** | Сценарии: «comm payment + ops block», «location low confidence + upsell attempt» — ожидаемый приоритет. |
| **Частота** | После X1 — на PR в оркестратор. |
| **Regression** | Нарушение таблицы приоритетов. |
| **Pass** | `PlatformDecision` валиден по схеме; ни один модуль не перезаписывает safety. |
