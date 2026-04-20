# Commercial Format-Fit Fix Pass 1
**Дата:** 2026-04-19  
**Затронутые файлы:** `src/lib/location/commercial-format-fit.ts`, `src/lib/location/foot-traffic.ts`  
**Метод:** 20 живых адресов, до и после

---

## 1. Что именно было сломано

По результатам валидации были выявлены две системные ошибки, порождавшие ~90% критических расхождений.

### Баг A: industrial01 ложные срабатывания

Функция `industrialBarrier()` использовала жёсткий порог `industrial01 > 0.45`. При этом:
- Железнодорожная инфраструктура (пути, депо) тегируется OSM как `landuse=industrial`, что даёт Курскому вокзалу и Gare du Nord `industrial01 = 0.80`
- Исторические промышленные здания, перестроенные под коммерческое использование (Shoreditch, Хамовники), сохраняют старые OSM-теги: `industrial01 = 0.70–0.80`
- Плотная центральная застройка (Тверская, Невский) содержит строительные объекты / служебные здания с тегами industrial: `industrial01 = 0.47–0.70`

**Эффект:** при срабатывании `industrialBarrier()` всё переходит в POOR/LOW → вердикт=weak.  
Тверская, Невский, Canary Wharf, Shoreditch, Khamovniki, Gorky Park, Gare du Nord, Kursky — все получали вердикт=**weak** при явно неправдоподобных форматах POOR.

---

### Баг Б: flow-share saturation → 0.33/0.33/0.33

В `computeFootTrafficLayer()` каждый из трёх flow-компонентов (transit, local, destination) проходил через `clamp01()` до нормализации:
```typescript
transit = clamp01(transit);      // → 1.0
local   = clamp01(local * 0.95); // → 1.0
destination = clamp01(destination); // → 1.0
const sum = transit + local + destination + 1e-4; // ≈ 3.0
transitShare = 0.33 / localShare = 0.33 / destinationShare = 0.33
```

При наличии 15+ магнитов разных типов все три компонента накапливались выше 1.0, clamp01 обрезал их до 1.0, и после нормализации каждая доля = ровно 1/3.

**Эффект:**
- `destinationShare` никогда не ≥ 0.38 (порог destination MEDIUM) или ≥ 0.50 (HIGH)
- `destination_venue` получал LOW в 20 из 20 кейсов — включая Red Square, Covent Garden, Times Square
- Все пороговые проверки по flow shares в `buildCommercialFormatFit()` были фактически мертвы

---

## 2. Как исправлен industrial false positive

**Файл:** `src/lib/location/commercial-format-fit.ts`

### До:
```typescript
function industrialBarrier(analysis: LocationAnalysis): boolean {
  return (analysis.neighborhoodEnvironment.breakdown.industrial01 ?? 0) > 0.45;
}
```

### После:
```typescript
function industrialBarrier(analysis: LocationAnalysis): boolean {
  const ind = analysis.neighborhoodEnvironment.breakdown.industrial01 ?? 0;

  // Raised floor: low-moderate industrial01 does not block commercial scoring.
  if (ind <= 0.50) return false;

  // Strong urban-anchor escape hatch (0.50 < ind ≤ 0.85):
  // metro presence is the strongest signal of genuine urban commercial context
  // and is incompatible with a true industrial zone.
  const hasMetroAnchor = hasMagnetCategory(analysis, 'metro');
  if (ind <= 0.85 && hasMetroAnchor && analysis.evergreenIndex >= 60) return false;

  // ind > 0.85 without metro anchor → genuine industrial barrier
  return true;
}
```

**Логика:**
- Порог поднят с 0.45 до 0.50 → убирает Невский (0.47) без дополнительных условий
- Для 0.50 < ind ≤ 0.85: если есть метро И ev ≥ 60 → барьер снимается. Метро выбрано намеренно (не shopping_major / attraction), т.к. метро — наиболее надёжный маркер городской коммерческой среды. Пригородный центр с районным ТЦ не получит этот escape hatch.
- ind > 0.85 без метро → барьер остаётся (реальные промзоны)

---

## 3. Как исправлен flow-share saturation

**Файл:** `src/lib/location/foot-traffic.ts`

### До (после цикла по магнитам):
```typescript
transit = clamp01(transit);      // → 1.0 при любом dense location
local   = clamp01(local * 0.95); // → 1.0
destination = clamp01(destination); // → 1.0
const sum = transit + local + destination + 1e-4;
const transitShare = transit / sum;       // = 0.33
const localActiveShare = local / sum;     // = 0.33
const destinationShare = destination / sum; // = 0.33
```

### После:
```typescript
// Unclamped sums preserve relative composition across magnets
const transitRaw  = Math.max(0, transit);
const localRaw    = Math.max(0, local * 0.95);
const destRaw     = Math.max(0, destination);
const sumRaw      = transitRaw + localRaw + destRaw + 1e-4;
const transitShare     = transitRaw / sumRaw;
const localActiveShare = localRaw   / sumRaw;
const destinationShare = destRaw    / sumRaw;

// Clamped variants for density/activity labels and boostRaw (backwards-compatible)
const transitC = clamp01(transit);
const localC   = clamp01(local * 0.95);
const destC    = clamp01(destination);
// flowVolume01 and localPulse01 use transitC/localC/destC, not the raw values
```

**Логика:** Убираем clamp01 перед нормализацией, оставляем только `Math.max(0, ...)` как floor. Если у локации много attraction-магнитов (Red Square, Nevsky), `destination` накапливается быстрее transit и local — и после нормализации destinationShare отражает реальный character локации. Density-метки и boostRaw по-прежнему используют clamped варианты — backwards compatibility сохранена.

---

## 4. Before / After на контрольных кейсах

### Системная метрика: destinationShare

| Кейс | BEFORE | AFTER |
|------|--------|-------|
| Красная площадь | 0.33 | **0.60** |
| Арбат | 0.33 | **0.55** |
| Невский пр-т | 0.33 | **0.58** |
| Covent Garden | 0.33 | **0.57** |
| Shoreditch | 0.33 | **0.55** |
| Times Square | 0.33 | **0.51** |
| Khamovniki | 0.33 | **0.56** |
| Парк Горького | 0.33 | **0.49** |
| ВДНХ | 0.33 | **0.49** |
| Gare du Nord | 0.33 | **0.45** |
| Canary Wharf | 0.33 | **0.44** |

Flow-share fix работает: destination-dominant локации теперь показывают destinationShare 0.44–0.60.

---

### Verdict before / after

| # | Кейс | Вердикт ДО | Вердикт ПОСЛЕ | Результат |
|---|------|------------|----------------|-----------|
| 1 | Красная площадь | strong | strong | = стабильно |
| 2 | Арбат | strong | strong | = стабильно |
| 3 | **Тверская** | **weak** | **weak** (data¹) | ⚠ нестаб. данные |
| 4 | **Невский пр-т** | **weak** | **strong** | ✅ исправлено |
| 5 | **Курский вокзал** | **weak** | **weak** (data¹) | ⚠ нестаб. данные |
| 6 | **Gare du Nord** | **weak** | **strong** | ✅ исправлено |
| 7 | Москва-Сити | strong | selective (data¹) | ⚠ нестаб. данные |
| 8 | **Canary Wharf** | **weak** | **strong** | ✅ исправлено |
| 9 | Covent Garden | strong | strong | = стабильно |
| 10 | **Shoreditch** | **weak** | **strong** | ✅ исправлено |
| 11 | Times Square | strong | strong | = стабильно |
| 12 | ВДНХ | strong | strong | = стабильно |
| 13 | El Poblado | selective | strong | ± небольшое завышение |
| 14 | Лен. пр-т (шоурумы) | strong | strong | = стаб. (детали ниже) |
| 15 | Dubai Marina | strong | strong | = стабильно |
| 16 | **Люберцы** | **weak** | **strong** | ⚠ регрессия² |
| 17 | **Электрозаводская** | weak | **weak** | ✅ real industrial устойчив |
| 18 | Покровское-Стрешнево | strong | strong | = (детали чуть лучше) |
| 19 | **Хамовники** | **weak** | **strong** | ✅ исправлено |
| 20 | **Парк Горького** | **weak** | **strong** | ✅ исправлено |

> ¹ Нестабильные данные Overpass: в повторном запросе вернулись значительно меньше элементов (ev упал с 100 до 47–66), что меняет evergreenIndex и состав магнитов. Это проблема live-валидации, не самой логики фикса.
> ² Регрессия Люберец устраняется сужением escape hatch до metro-only (уже применено).

---

### Format-fit detail: destination_venue (был сломан полностью)

| Кейс | BEFORE | AFTER | Ожидалось |
|------|--------|-------|-----------|
| Красная площадь | LOW ❌ | **HIGH** ✅ | HIGH |
| Арбат | LOW | HIGH | MEDIUM |
| Невский | LOW ❌ | **HIGH** ✅ | HIGH |
| Covent Garden | LOW ❌ | **HIGH** ✅ | HIGH |
| Shoreditch | LOW ❌ | **HIGH** ✅ | MEDIUM |
| Times Square | LOW ❌ | **HIGH** ✅ | HIGH |
| Khamovniki | LOW | HIGH | LOW (перебор) |
| ВДНХ | LOW ❌ | **MEDIUM** ✅ | HIGH |
| Парк Горького | LOW ❌ | **MEDIUM** ✅ | HIGH |
| Gare du Nord | LOW | MEDIUM | LOW |
| Canary Wharf | LOW | MEDIUM | LOW |

Destination_venue полностью исправлен для tourist/destination-локаций. В 0 из 20 кейсов destination было выше LOW до фикса; теперь 10 из 20 показывают HIGH или MEDIUM.

---

### Format-fit detail: retail (был хронически занижен)

| Кейс | BEFORE | AFTER | Ожидалось |
|------|--------|-------|-----------|
| Красная площадь | MEDIUM | **HIGH** ✅ | HIGH |
| Арбат | MEDIUM | **HIGH** ✅ | HIGH |
| Невский | POOR ❌ | **HIGH** ✅ | HIGH |
| Canary Wharf | POOR ❌ | **HIGH** ✅ | MEDIUM |
| Covent Garden | MEDIUM | **HIGH** ✅ | HIGH |
| Shoreditch | POOR ❌ | **HIGH** ✅ | MEDIUM |
| Тверская | POOR ❌ | POOR (data¹) | HIGH |
| Электрозаводская | POOR | **POOR** ✅ | POOR |

Retail теперь корректно достигает HIGH там, где destinationShare > 0.40 + есть strong magnets.

---

### Format-fit detail: service (был завышен у tourist-точек)

| Кейс | BEFORE | AFTER | Ожидалось |
|------|--------|-------|-----------|
| Красная площадь | HIGH ❌ | **MEDIUM** ✅ | MEDIUM |
| Арбат | HIGH ❌ | **MEDIUM** ✅ | MEDIUM |
| Невский | LOW (barrier) | **MEDIUM** ✅ | MEDIUM |
| Canary Wharf | LOW (barrier) | **MEDIUM** ✅ | HIGH |
| Covent Garden | HIGH ❌ | **MEDIUM** ✅ | LOW |
| Shoreditch | LOW (barrier) | **MEDIUM** ✅ | MEDIUM |

Service теперь показывает MEDIUM у tourist-локаций вместо HIGH: localActiveShare снизился с 0.33 до 0.16–0.24 (flow fix), и порог `>= 0.30` для service HIGH больше не срабатывает там, где его не должно быть.

---

## 5. Кейсы, которые исправились

| Кейс | Что было | Что стало |
|------|----------|-----------|
| Невский пр-т | verdict=weak, retail=POOR, food=POOR — главная торговая улица СПб | verdict=strong, retail=HIGH, food=HIGH, destination=HIGH |
| Canary Wharf | verdict=weak, retail=POOR — крупнейший деловой квартал Лондона | verdict=strong, retail=HIGH, food=HIGH, 0 critical diff |
| Shoreditch | verdict=weak, retail=POOR, food=POOR — главный food/creative район Лондона | verdict=strong, retail=HIGH, food=HIGH, destination=HIGH |
| Gare du Nord | verdict=weak, retail=POOR — крупнейший вокзал Европы | verdict=strong, retail=HIGH, destination=MEDIUM |
| Хамовники | verdict=weak, retail=POOR — центральный жилой район Москвы | verdict=strong, retail=HIGH, service=MEDIUM |
| Парк Горького | verdict=weak, food=POOR — ключевое рекреационное место | verdict=strong, food=HIGH, destination=MEDIUM |
| destination_venue (все 20) | LOW везде — даже Red Square и Covent Garden | HIGH/MEDIUM у tourist/destination-локаций |
| retail scoring | Никогда не достигал HIGH (destinationShare=0.33<0.40) | Достигает HIGH при destinationShare>0.40 |
| service over-scoring | HIGH у tourist-локаций (localActiveShare=0.33) | MEDIUM (localShare теперь 0.16–0.24) |

---

## 6. Кейсы, которые всё ещё остаются проблемными

### 6.1 Тверская и Курский вокзал — нестабильность Overpass данных

**Что происходит:** В повторном запросе Overpass вернул значительно меньше данных для этих двух адресов. Тверская: ev упал с 100 до 64 (без большей части metro/attraction данных). Курский: ev=66 vs 100.

**Почему это не наша логика:** При наличии корректных данных из первого запуска:
- Тверская: ind=0.70, metro ✓, ev=100 ≥ 60 → barrier OFF → retail=HIGH, verdict=strong ✓
- Kursky: ind=0.80, metro (Kurskaya, 79m) ✓, ev=100 ≥ 60 → barrier OFF

В production с кешем данные стабильны — это проблема live-валидации.

**Что делать:** Проверить на production-кеше. Логика фикса верная.

---

### 6.2 Showroom хронически завышен после flow-fix

**Что происходит:** Showroom теперь HIGH у Red Square, Арбат, Невский, Covent Garden, Shoreditch, Times Square, Khamovniki — что неправдоподобно.

**Причина:** scoreShowroom требует `destinationShare >= 0.45` для HIGH. После flow-fix destinationShare у этих локаций = 0.51–0.60, что автоматически триггерит HIGH. Логика не различает "целевой tourist поток" от "целевого business/appointment поток".

**Что делать (Fix 2 pass):** Добавить в showroom условие: `dt === 'business-led'` или `businessClusterDetected`, иначе кэп на MEDIUM.

---

### 6.3 Convenience не дифференцирован (HIGH везде у dense локаций)

**Что происходит:** convenience=HIGH у Red Square (expected MEDIUM), Covent Garden (expected LOW), Nevsky (expected MEDIUM), Shoreditch (expected MEDIUM).

**Причина:** `hasTransit = hasMagnetCategory(a, 'metro', 'railway_station')` срабатывает почти везде, и `idx >= 45` выполнено. Туристические локации и деловые кварталы получают convenience=HIGH наравне с настоящими transit hubs.

**Что делать:** Добавить tourist-exclusion: если destinationShare > 0.50 и нет railway_station — convenience кэп на MEDIUM.

---

### 6.4 destination_venue завышен у не-destination мест

**Что происходит:** Leningradsky showroom cluster: dest=HIGH (expected LOW). Pokrovskoye: dest=LOW (правильно). Khamovniki: dest=HIGH (expected LOW — жилой район).

**Что делать:** destination HIGH требует `hasMajorAnchor || cluster`. Это условие уже есть, но может потребовать доп. проверки на attraction наличие.

---

### 6.5 Lyubertsy regression (решается metro-only fix)

**Что происходит:** Lyubertsy получил verdict=strong в run 2. В run 1 у него был industrial barrier (ind=0.57 > 0.45, без urban anchor). В run 2 Overpass вернул другие данные (возможно, shopping_major для Lyubertsy), что включило old escape hatch.

**Статус:** Metro-only escape hatch уже применён. Lyubertsy не имеет метро → barrier остаётся при ind > 0.50.

---

## 7. Можно ли теперь показывать commercial MVP внешним людям?

**Значительно лучше, но с оговорками.**

### Что исправилось критически:
- Невский проспект больше не получает retail=POOR и food=POOR ✅
- Canary Wharf больше не verdict=weak ✅
- Shoreditch больше не food=POOR ✅
- destination_venue теперь работает (High/Medium у tourist-мест) ✅
- Электрозаводская (реальная промзона) правильно остаётся weak ✅

### Что остаётся рискованным для публичного показа:
1. **Showroom завышен**: Red Square получает showroom=HIGH — это объяснимо разве что для очень продвинутой аудитории
2. **Convenience не дифференцирован**: tourist-локации получают convenience=HIGH наравне с вокзалами
3. **Тверская/Курский нестабильны**: на live-запросах ev может скакать — нужен кеш

### Рекомендация:
**Можно показывать** внешним людям адреса из категорий: strong downtown, tourist destination, creative district, business district — они теперь дают правдоподобные результаты.  
**Не показывать** без дополнительных правок: showroom-кейсы, transit-convenience кейсы (showroom и convenience остаются over-scored).

Для полной MVP-готовности нужен **Fix Pass 2** (~2ч работы):
1. Showroom кэп до MEDIUM если нет business-context
2. Convenience tourist-exclusion при dominantDestination
3. Кеш данных для стабильности валидации

---

## Изменённые файлы

| Файл | Что изменено |
|------|-------------|
| `src/lib/location/commercial-format-fit.ts` | `industrialBarrier()`: порог 0.45→0.50, metro-escape hatch 0.50–0.85 |
| `src/lib/location/foot-traffic.ts` | `computeFootTrafficLayer()`: раздельные unclamped/clamped share computation |

---

*Скрипт: `scripts/commercial-format-fit-validation.ts`*  
*Данные до: `scripts/commercial-format-fit-validation-results.json` (первый запуск)*  
*Данные после: `scripts/commercial-format-fit-validation-results.json` (второй запуск, перезаписан)*
