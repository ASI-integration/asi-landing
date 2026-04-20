# Neighborhood quality — soft modifier pass-2 implementation

> Дата: 2026-04-18.  
> Артефакты: без нового global run. Пересчёт снимков по `scripts/neighborhood-quality-control-results.json`  
> через `scripts/neighborhood-quality-soft-modifier-from-json.ts`.

---

## 1. Что именно изменено в коде

Файл: [`src/lib/location/neighborhood-environment-commercial-modifier.ts`](../src/lib/location/neighborhood-environment-commercial-modifier.ts)

### Изменение A — `nominalReductionFraction` (строки 22–30)

```typescript
// BEFORE (pass-1)
if (concern === 'elevated') {
  return neighborhoodConfidence === 'high' ? 0.045 : 0.03;
}
return neighborhoodConfidence === 'high' ? 0.08 : 0.06;

// AFTER (pass-2)
if (concern === 'elevated') {
  return neighborhoodConfidence === 'high' ? 0.06 : 0.04;   // +1.5pp / +1pp
}
return neighborhoodConfidence === 'high' ? 0.08 : 0.07;    // unchanged / +1pp
```

| Параметр | Pass-1 | Pass-2 | Δ |
|----------|--------|--------|---|
| `elevated` + high conf | 4.5% | **6.0%** | +1.5pp |
| `elevated` + medium conf | 3.0% | **4.0%** | +1pp |
| `high` + high conf | 8.0% | 8.0% | — |
| `high` + medium conf | 6.0% | **7.0%** | +1pp |

### Изменение B — floor logic (строки 144–150)

```typescript
// BEFORE (pass-1) — одинаковый floor для всех concern levels
if (base >= 70) {
  const maxByStrongFloor = base - 70;
  ...
}

// AFTER (pass-2) — differentiated floor по severity
// elevated → floor 70 (protect solid demand cores from a one-step band drop).
// high → floor 67 (allow meaningful reduction when environment concern is serious).
const strongBandFloor = concern === 'high' ? 67 : 70;
if (base >= strongBandFloor) {
  const maxByStrongFloor = base - strongBandFloor;
  ...
}
```

Итого: **2 изменения** в 1 файле. `config.ts`, `gravity-scoring.ts`, `location-score.ts`, `neighborhood-environment.ts` не тронуты.

---

## 2. Before / After по ключевым кейсам

Прогон: `npx tsx scripts/neighborhood-quality-soft-modifier-from-json.ts` — дважды, до и после патча.

| Кейс | Тип | EV | Base | NE tier | Pass-1 after | Pass-2 after | Δ изменение |
|------|-----|----|----|---------|-------------|-------------|-------------|
| **Cannes** | resort/high NE | 100 | 71 | high/high | 70 **(floor-blocked)** | **67** | −1 → −4 ✓ |
| **Ozone Park** | false premium | 97 | 100 | elevated/high | 95 | **94** | −5 → −6 ✓ |
| **Lyubertsy** | false suburb | 96 | 88 | elevated/high | 84 | **83** | −4 → −5 ✓ |
| **Sochi center** | resort + friction | 63 | 65 | elevated/high | 62 | **61** | −3 → −4 ✓ |
| Times Square | iconic CBD | 100 | 74 | moderate | 74 | **74** | 0 → 0 ✓ |
| Causeway Bay | strong CBD | 100 | 80 | moderate | 80 | **80** | 0 → 0 ✓ |
| Miami Brickell | strong CBD | 100 | 92 | moderate | 92 | **92** | 0 → 0 ✓ |
| Canary Wharf | strong CBD | 65 | 76 | moderate | 76 | **76** | 0 → 0 ✓ |
| Pechatniki | industrial/false | 56 | 89 | moderate | 89 | **89** | 0 → 0 ✓ |
| Kazan center | regional center | 100 | 80 | moderate | 80 | **80** | 0 → 0 ✓ |
| El Poblado | strong viable | 80 | 62 | moderate | 62 | **62** | 0 → 0 ✓ |
| Dubai Marina | weak OSM | 23 | 47 | moderate | 47 | **47** | 0 → 0 ✓ |

### Детальный разбор ключевых случаев

**Cannes (главный тест pass-2)**  
- Pass-1: base=71, high/high → nominal 8%×71=5.7→6 pts, но floor 70 обрезал до 1 pt → 70.  
- Pass-2: floor для `high` = 67 → max_cut = 71−67 = 4 pts, nominal 6 pts ограничен до 4 → **67**.  
- Итог: пол больше не блокирует. High tier дал реальный штраф −4 вместо −1.  
- Rating-band: 67 попадает в viable (если strong ≥ 70). Для Croisette с NE=77/high — обоснованная осторожность.

**Ozone Park**  
- Pass-1: 6%→6pts (floor не активен, 100−70=30 даёт запас) → 95.  
- Pass-2: wait, 6%×100=6 → **94**. Изменение правильное: −5→−6.  
  *(Примечание: в pass-2 nominal теперь 6%, в pass-1 было 4.5%; 4.5%×100=4.5→5 pts округлённо. При 6% → 6 pts → 94. Верно.)*
- Остаётся exceptional, но чуть более осторожный headline для аэропортного пригорода.

**Lyubertsy**  
- Pass-1: 4.5%×88=3.96→4 pts → 84.  
- Pass-2: 6%×88=5.28→5 pts → **83**.  
- Остаётся strong (83≥70), но −1 дополнительный пункт в сторону реализма для «слабого пригорода».

**Sochi**  
- Pass-1: 4.5%×65=2.92→3 pts → 62.  
- Pass-2: 6%×65=3.9→4 pts → **61**.  
- Остаётся viable. EV=63 тоже на medium-уровне — 61 согласован.

**Все moderate-кейсы (8 штук)**  
Times Square, Causeway Bay, Brickell, Canary Wharf, Kazan, El Poblado, Dubai Marina, Pechatniki — **ни один не сдвинулся**. `skipReason: 'concern_below_elevated'` срабатывает до logики fraction, moderate обработка не затронута изменениями.

---

## 3. Появились ли регрессии

**Нет.** Проверка по четырём критериям:

| Проверка | Результат |
|----------|-----------|
| Cannes больше не зажимается floor=70 | ✓ 70→67, floor=67 сработал без блокировки |
| Elevated кейсы стали реалистичнее | ✓ Ozone Park −5→−6, Lyubertsy −4→−5, Sochi −3→−4 |
| Честные strong-core не сломаны | ✓ Brickell 92, Causeway Bay 80, Times Square 74 без изменений |
| Moderate не получает слепой штраф | ✓ Все 8 moderate кейсов: Δ=0 |

Дополнительно: Cannes переходит из strong в viable (71→67). Это **не регрессия**, а намеренное поведение pass-2: NE=77/high с 5 активными стрессорами должен давать ощутимое снижение. Риск отмечен в pass-2 plan как потенциальный false alarm (waterfront industrial OSM), но без полевого feedback это принятый компромисс.

---

## 4. Можно ли считать pass-2 калибровку принятой

**Да, с одной оговоркой.**

**Принять:**
- Все числовые результаты соответствуют плану из `docs/neighborhood-quality-soft-modifier-pass-2-plan.md`.
- Нет регрессий на честных strong-core кейсах.
- Moderate handling не изменён.
- Код минимален: 2 изменения, 1 файл, оба параметрические.
- Скрипт `from-json` воспроизводим без сети — верификация детерминирована.

**Оговорка — Cannes в viable:**
Cannes (EV=100) попадает в 67 — это ниже strong-порога (70). Если в будущем будет размеченный ground truth с Cannes Croisette как «strong», это вернётся как калибровочный кейс. Пока — обоснованная осторожность при NE=77/high.

**Что остаётся за рамками pass-2 (не регрессия, backlog):**
- Pechatniki (EV=56, headline=89) — commercial model issue, не NE. Pass-3 с EV-gating.
- Lyubertsy «слишком оптимистично» (83 при «слабом suburb») — EV=96 driver, не NE. Commercial model.
- LIC (Long Island City) — нет контрольных данных из-за таймаута.

---

## Итог

**Изменено:** 2 строки конфигурационных констант + 1 строка floor-logic в `computeNeighborhoodEnvironmentCommercialModifier`.  
**Улучшились:** Cannes (−1→−4, главный результат), Ozone Park (−5→−6), Lyubertsy (−4→−5), Sochi (−3→−4).  
**Регрессий нет:** все 8 moderate-кейсов без изменений, все strong CBD без изменений.  
**Статус:** pass-2 калибровка принята.
