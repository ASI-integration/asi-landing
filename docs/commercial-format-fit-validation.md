# Commercial Format-Fit Validation Report
**Дата:** 2026-04-19  
**Метод:** Live OSM fetch → buildAnalysis → buildCommercialFormatFit × 20 адресов  
**Цель:** Полевая проверка текущей матрицы до рефакторинга

---

## 1. Список всех адресов

| # | ID | Адрес | Тип | Bucket | EV | industrial01 | Вердикт модели |
|---|-----|-------|-----|--------|----|-------------|----------------|
| 1 | red_square_moscow | Красная площадь, Москва | destination_venue | strong | 100 | 0.17 | strong |
| 2 | arbat_moscow | Арбат, Москва | retail | strong | 100 | 0.17 | strong |
| 3 | tverskaya_moscow | Тверская ул., Москва | retail | strong | 100 | 0.70 | **weak** |
| 4 | nevsky_spb | Невский пр-т, СПб | retail | strong | 100 | 0.47 | **weak** |
| 5 | kursky_station_moscow | Курский вокзал, Москва | convenience | transit | 100 | 0.80 | **weak** |
| 6 | gare_du_nord_paris | Gare du Nord, Париж | convenience | transit | 100 | 0.80 | **weak** |
| 7 | moscow_city | Москва-Сити | service | business | 100 | 0.17 | strong |
| 8 | canary_wharf_london | Canary Wharf, Лондон | service | business | 100 | 0.57 | **weak** |
| 9 | covent_garden_london | Covent Garden, Лондон | destination_venue | destination | 100 | 0.37 | strong |
| 10 | shoreditch_london | Shoreditch, Лондон | food_beverage | destination | 100 | 0.80 | **weak** |
| 11 | times_square_nyc | Times Square, NYC | destination_venue | strong | 100 | 0.37 | strong |
| 12 | vdnkh_moscow | ВДНХ, Москва | destination_venue | destination | 100 | 0.37 | strong |
| 13 | el_poblado_medellin | El Poblado, Медельин | food_beverage | destination | 89 | 0.17 | selective |
| 14 | leningradsky_showroom_moscow | Лен. пр-т (шоурумы), Москва | showroom | showroom | 100 | 0.37 | strong |
| 15 | dubai_marina | Dubai Marina, Дубай | destination_venue | destination | 94 | 0.17 | strong |
| 16 | lyubertsy_center | Люберцы центр | convenience | weak | 96 | 0.57 | weak |
| 17 | elektrozavodskaya_moscow | Электрозаводская, Москва | service | industrial | 100 | 1.00 | weak |
| 18 | pokrovskoye_streshnevo | Покровское-Стрешнево, Москва | service | residential | 89 | 0.37 | **strong** |
| 19 | khamovniki_moscow | Хамовники, Москва | service | residential | 100 | 0.80 | **weak** |
| 20 | gorky_park_moscow | Парк Горького, Москва | food_beverage | destination | 100 | 0.70 | **weak** |

**Жирный вердикт** = расхождение с ожидаемым на 2+ уровня или явно неправдоподобный вердикт.

---

## 2. Карточки кейсов

---

### Кейс 1: Красная площадь, Москва
**Адрес:** 55.7540, 37.6208 · bucket: strong  
**Что ожидалось:** retail=HIGH, food=HIGH, service=MEDIUM, convenience=MEDIUM, showroom=LOW, destination=HIGH  
**Что показала модель:** retail=MEDIUM, food=HIGH, service=HIGH, convenience=HIGH, showroom=MEDIUM, destination=LOW  
**Overall verdict:** strong (ожидалось: strong) ✓

**Что попало правильно:** food=HIGH (верно). Overall verdict=strong (верно).  
**Что попало мимо:**
- destination_venue=LOW (ожидалось HIGH) — **КРИТИЧНО**. Красная площадь — одно из главных туристических мест мира, получает LOW по destination.
- convenience=HIGH (ожидалось MEDIUM) — туристическая точка не является convenience-локацией.
- service=HIGH (ожидалось MEDIUM) — туристы не ходят к барберу.
- showroom=MEDIUM (ожидалось LOW) — нет b2b-аудитории на Красной площади.
- retail=MEDIUM (ожидалось HIGH) — очевидный retail-потенциал не распознан.

**Корень проблем:**
1. `destinationShare=0.33` — share насыщается (см. системные проблемы). При пороге 0.38/0.50 destination никогда не достигает MEDIUM/HIGH.
2. `localActiveShare=0.33` ≥ 0.30 → service=HIGH (хотя это tourist-трафик, не residential).
3. `transitShare=0.33` ≥ 0.35 + density=high → convenience=HIGH (хотя tourist, не utility flow).

**Уровень проблемы:** Критично (destination) / Средне (остальное)

---

### Кейс 2: Арбат, Москва
**Адрес:** 55.7500, 37.5958 · bucket: strong  
**Что ожидалось:** retail=HIGH, food=HIGH, service=MEDIUM, convenience=LOW, showroom=LOW, destination=MEDIUM  
**Что показала модель:** retail=MEDIUM, food=HIGH, service=HIGH, convenience=HIGH, showroom=MEDIUM, destination=LOW  
**Overall verdict:** strong (ожидалось: strong) ✓

**Что попало правильно:** food=HIGH (верно). Overall verdict.  
**Что попало мимо:**
- convenience=HIGH (ожидалось LOW) — **КРИТИЧНО**. Туристическая пешеходная улица — не convenience-локация.
- destination=LOW (ожидалось MEDIUM) — Арбат — знаковое место с целевым туристическим потоком.
- service=HIGH (ожидалось MEDIUM) — завышено.
- retail=MEDIUM (ожидалось HIGH) — один из главных retail-адресов Москвы.
- showroom=MEDIUM (ожидалось LOW) — без b2b-контекста.

**Уровень проблемы:** Критично (convenience), Средне (retail, destination, service)

---

### Кейс 3: Тверская улица, Москва
**Адрес:** 55.7654, 37.6064 · bucket: strong  
**Что ожидалось:** retail=HIGH, food=HIGH, service=HIGH, convenience=MEDIUM, showroom=MEDIUM, destination=MEDIUM  
**Что показала модель:** retail=POOR, food=POOR, service=LOW, convenience=LOW, showroom=LOW, destination=LOW  
**Overall verdict:** weak (ожидалось: strong) ✗ — **ПОЛНЫЙ ПРОВАЛ**

**Что попало правильно:** Ничего.  
**Что попало мимо:** Буквально всё — главная торговая улица Москвы получила retail=POOR, food=POOR.

**Корень проблемы:**  
`industrial01=0.70` → `industrialBarrier()` возвращает `true` (порог > 0.45) → всё переключается на POOR/LOW.  
OSM вокруг Тверской содержит строительные объекты/коммерческую инфраструктуру, ошибочно классифицированные как industrial. Тверская НЕ промышленная зона.

**Уровень проблемы:** КРИТИЧНО — полная дисквалификация правильной локации.

---

### Кейс 4: Невский проспект, Санкт-Петербург
**Адрес:** 59.9344, 30.3424 · bucket: strong  
**Что ожидалось:** retail=HIGH, food=HIGH, service=MEDIUM, convenience=MEDIUM, showroom=LOW, destination=MEDIUM  
**Что показала модель:** retail=POOR, food=POOR, service=LOW, convenience=LOW, showroom=LOW, destination=LOW  
**Overall verdict:** weak (ожидалось: strong) ✗ — **ПОЛНЫЙ ПРОВАЛ**

**Корень проблемы:** `industrial01=0.47` → незначительно пересекает порог 0.45 → полная дисквалификация.  
Главная улица СПб называется "слабой" из-за небольшой разницы в industrial01 (0.47 vs 0.45).

**Уровень проблемы:** КРИТИЧНО

---

### Кейс 5: Курский вокзал, Москва
**Адрес:** 55.7592, 37.6600 · bucket: transit  
**Что ожидалось:** retail=MEDIUM, food=MEDIUM, service=LOW, convenience=HIGH, showroom=POOR, destination=LOW  
**Что показала модель:** retail=POOR, food=POOR, service=LOW, convenience=LOW, showroom=LOW, destination=LOW  
**Overall verdict:** weak (ожидалось: selective) ✗

**Что попало правильно:** service=LOW, destination=LOW (верно).  
**Что попало мимо:**
- convenience=LOW (ожидалось HIGH) — **КРИТИЧНО**. Вокзал — классическая convenience-точка. Модель дала LOW.
- retail=POOR, food=POOR (ожидалось MEDIUM) — явные форматы для вокзала полностью отвергнуты.

**Корень проблемы:** `industrial01=0.80` — железнодорожная инфраструктура (рельсы, пути, депо) ошибочно классифицирована как industrial. Вокзалы повсеместно получают завышенный industrial01.

**Уровень проблемы:** КРИТИЧНО

---

### Кейс 6: Gare du Nord, Париж
**Адрес:** 48.8809, 2.3553 · bucket: transit  
**Что ожидалось:** retail=MEDIUM, food=MEDIUM, service=LOW, convenience=HIGH, showroom=POOR, destination=LOW  
**Что показала модель:** retail=POOR, food=POOR, service=LOW, convenience=LOW, showroom=LOW, destination=LOW  
**Overall verdict:** weak (ожидалось: selective) ✗

**Корень проблемы:** Та же проблема, что и Курский — `industrial01=0.80`. Европейские крупные вокзалы получают максимальный industrial01 из-за железнодорожной инфраструктуры.

**Уровень проблемы:** КРИТИЧНО

---

### Кейс 7: Москва-Сити
**Адрес:** 55.7482, 37.5403 · bucket: business  
**Что ожидалось:** retail=MEDIUM, food=HIGH, service=HIGH, convenience=MEDIUM, showroom=HIGH, destination=MEDIUM  
**Что показала модель:** retail=MEDIUM, food=HIGH, service=HIGH, convenience=HIGH, showroom=MEDIUM, destination=LOW  
**Overall verdict:** strong (ожидалось: strong) ✓ (с оговорками)

**Что попало правильно:** food=HIGH, service=HIGH, retail=MEDIUM. Overall=strong приемлемо.  
**Что попало мимо:**
- convenience=HIGH (ожидалось MEDIUM) — небольшое завышение.
- showroom=MEDIUM (ожидалось HIGH) — деловой кластер занижает showroom.
- destination=LOW (ожидалось MEDIUM) — туристы смотрят на небоскрёбы.

**Уровень проблемы:** Незначительно / Средне. Это один из лучших результатов в наборе.

---

### Кейс 8: Canary Wharf, Лондон
**Адрес:** 51.5054, -0.0235 · bucket: business  
**Что ожидалось:** retail=MEDIUM, food=HIGH, service=HIGH, convenience=MEDIUM, showroom=MEDIUM, destination=LOW  
**Что показала модель:** retail=POOR, food=POOR, service=LOW, convenience=LOW, showroom=LOW, destination=LOW  
**Overall verdict:** weak (ожидалось: strong) ✗ — **ПОЛНЫЙ ПРОВАЛ**

**Корень проблемы:** `industrial01=0.57`. Финансовый деловой квартал Лондона — один из крупнейших в мире — получает verdict=weak из-за industrial01.  
Предположительно: башни, трубы, технические сооружения или конструкционные элементы в OSM ошибочно помечены.

**Уровень проблемы:** КРИТИЧНО

---

### Кейс 9: Covent Garden, Лондон
**Адрес:** 51.5121, -0.1230 · bucket: destination  
**Что ожидалось:** retail=HIGH, food=HIGH, service=LOW, convenience=LOW, showroom=LOW, destination=HIGH  
**Что показала модель:** retail=MEDIUM, food=HIGH, service=HIGH, convenience=HIGH, showroom=MEDIUM, destination=LOW  
**Overall verdict:** strong (ожидалось: strong) ✓ (verdict случайно верный)

**Что попало правильно:** food=HIGH, overall=strong.  
**Что попало мимо:**
- destination=LOW (ожидалось HIGH) — **КРИТИЧНО**. Covent Garden — один из главных tourist destination Лондона.
- convenience=HIGH (ожидалось LOW) — туристический рынок, не convenience-место.
- service=HIGH (ожидалось LOW) — туристы не ходят в химчистку в Covent Garden.
- retail=MEDIUM (ожидалось HIGH) — classic retail destination занижен.

**Уровень проблемы:** Критично (destination), Средне (convenience, service, retail)

---

### Кейс 10: Shoreditch High Street, Лондон
**Адрес:** 51.5227, -0.0783 · bucket: destination  
**Что ожидалось:** retail=MEDIUM, food=HIGH, service=MEDIUM, convenience=MEDIUM, showroom=LOW, destination=MEDIUM  
**Что показала модель:** retail=POOR, food=POOR, service=LOW, convenience=LOW, showroom=LOW, destination=LOW  
**Overall verdict:** weak (ожидалось: selective) ✗ — **ПОЛНЫЙ ПРОВАЛ**

**Корень проблемы:** `industrial01=0.80`. Hipster-квартал Лондона с огромным количеством ресторанов и баров получает retail=POOR и food=POOR из-за того, что OSM-данные содержат много industrial-тегов (исторические фабрики, перестроенные под творческие пространства, строительные площадки джентрификации).

**Уровень проблемы:** КРИТИЧНО — Shoreditch — классический food & service destination.

---

### Кейс 11: Times Square, Нью-Йорк
**Адрес:** 40.7580, -73.9855 · bucket: strong  
**Что ожидалось:** retail=HIGH, food=HIGH, service=LOW, convenience=MEDIUM, showroom=LOW, destination=HIGH  
**Что показала модель:** retail=MEDIUM, food=HIGH, service=HIGH, convenience=HIGH, showroom=MEDIUM, destination=LOW  
**Overall verdict:** strong (ожидалось: strong) ✓ (verdict верный, детали нет)

**Что попало правильно:** food=HIGH, overall=strong.  
**Что попало мимо:**
- destination=LOW (ожидалось HIGH) — **КРИТИЧНО**. Times Square — главная туристическая точка США.
- service=HIGH (ожидалось LOW) — туристы не пользуются бытовым сервисом здесь.
- convenience=HIGH (ожидалось MEDIUM) — небольшое завышение.
- retail=MEDIUM (ожидалось HIGH) — занижено.

**Уровень проблемы:** Критично (destination), Средне (service, retail)

---

### Кейс 12: ВДНХ, Москва
**Адрес:** 55.8278, 37.6316 · bucket: destination  
**Что ожидалось:** retail=LOW, food=MEDIUM, service=LOW, convenience=MEDIUM, showroom=MEDIUM, destination=HIGH  
**Что показала модель:** retail=MEDIUM, food=HIGH, service=HIGH, convenience=HIGH, showroom=MEDIUM, destination=LOW  
**Overall verdict:** strong (ожидалось: selective) — завышено

**Что попало правильно:** showroom=MEDIUM (верно).  
**Что попало мимо:**
- destination=LOW (ожидалось HIGH) — ВДНХ — крупный рекреационный destination Москвы.
- food=HIGH (ожидалось MEDIUM) — небольшое завышение.
- service=HIGH (ожидалось LOW) — завышено.
- retail=MEDIUM (ожидалось LOW) — завышено.
- convenience=HIGH (ожидалось MEDIUM) — небольшое завышение.
- Overall=strong (ожидалось selective) — завышен.

**Уровень проблемы:** Критично (destination), Средне (overall verdict)

---

### Кейс 13: El Poblado, Медельин
**Адрес:** 6.2089, -75.5690 · bucket: destination  
**Что ожидалось:** retail=MEDIUM, food=HIGH, service=MEDIUM, convenience=LOW, showroom=LOW, destination=MEDIUM  
**Что показала модель:** retail=MEDIUM, food=HIGH, service=HIGH, convenience=MEDIUM, showroom=MEDIUM, destination=LOW  
**Overall verdict:** selective (ожидалось: selective) ✓

**Что попало правильно:** food=HIGH, retail=MEDIUM, overall=selective. Лучший результат в наборе по overall.  
**Что попало мимо:**
- service=HIGH (ожидалось MEDIUM) — небольшое завышение.
- destination=LOW (ожидалось MEDIUM) — систематическая ошибка destination.
- showroom=MEDIUM (ожидалось LOW) — небольшое завышение.

**Уровень проблемы:** Незначительно. El Poblado — один из немногих разумных результатов.

---

### Кейс 14: Ленинградский пр-т (шоурумы), Москва
**Адрес:** 55.7855, 37.5245 · bucket: showroom  
**Что ожидалось:** retail=LOW, food=LOW, service=MEDIUM, convenience=LOW, showroom=HIGH, destination=LOW  
**Что показала модель:** retail=MEDIUM, food=HIGH, service=HIGH, convenience=HIGH, showroom=MEDIUM, destination=LOW  
**Overall verdict:** strong (ожидалось: selective) — завышено

**Что попало правильно:** destination=LOW (верно).  
**Что попало мимо:**
- showroom=MEDIUM (ожидалось HIGH) — **КРИТИЧНО**. Классический showroom-кластер получает только MEDIUM.
- food=HIGH (ожидалось LOW) — завышено. Ленинградка — не food-улица.
- convenience=HIGH (ожидалось LOW) — завышено.
- retail=MEDIUM (ожидалось LOW) — завышено.
- service=HIGH (ожидалось MEDIUM) — небольшое завышение.
- Overall=strong (ожидалось selective) — завышен вердикт.

**Уровень проблемы:** Критично (showroom недооценён, всё остальное переоценено)

---

### Кейс 15: Dubai Marina, Дубай
**Адрес:** 25.0819, 55.1407 · bucket: destination  
**Что ожидалось:** retail=MEDIUM, food=HIGH, service=MEDIUM, convenience=MEDIUM, showroom=HIGH, destination=HIGH  
**Что показала модель:** retail=MEDIUM, food=HIGH, service=HIGH, convenience=HIGH, showroom=MEDIUM, destination=LOW  
**Overall verdict:** strong (ожидалось: strong) ✓ (verdict верный)

**Что попало правильно:** food=HIGH, retail=MEDIUM, overall=strong.  
**Что попало мимо:**
- destination=LOW (ожидалось HIGH) — **КРИТИЧНО**. Марина — крупный туристический destination.
- showroom=MEDIUM (ожидалось HIGH) — luxury showroom контекст не распознан.
- service=HIGH (ожидалось MEDIUM) — небольшое завышение.
- convenience=HIGH (ожидалось MEDIUM) — небольшое завышение.

**Уровень проблемы:** Критично (destination), Средне (showroom)

---

### Кейс 16: Центр Люберец, Подмосковье
**Адрес:** 55.6769, 37.8942 · bucket: weak  
**Что ожидалось:** retail=LOW, food=LOW, service=MEDIUM, convenience=MEDIUM, showroom=POOR, destination=POOR  
**Что показала модель:** retail=POOR, food=POOR, service=LOW, convenience=LOW, showroom=LOW, destination=LOW  
**Overall verdict:** weak (ожидалось: weak) ✓ — верный вердикт, неверные детали

**Что попало правильно:** Overall=weak (верно).  
**Что попало мимо:**
- service=LOW (ожидалось MEDIUM) — у Люберец есть локальный жилой поток для сервиса.
- convenience=LOW (ожидалось MEDIUM) — у Люберец есть жилая аудитория.

**Корень проблемы:** `industrial01=0.57` даёт промышленный барьер. Пригород задавлен industrial01 так же как крупные деловые районы.

**Уровень проблемы:** Средне (правильный вердикт, но детали неверны и по неправильным причинам)

---

### Кейс 17: Электрозаводская, Москва (промзона)
**Адрес:** 55.7840, 37.7062 · bucket: industrial  
**Что ожидалось:** retail=POOR, food=LOW, service=LOW, convenience=LOW, showroom=POOR, destination=POOR  
**Что показала модель:** retail=POOR, food=POOR, service=LOW, convenience=LOW, showroom=LOW, destination=LOW  
**Overall verdict:** weak (ожидалось: weak) ✓ — один из немногих правильных результатов

**Что попало правильно:** Почти всё — это реально промышленная зона.  
**Что попало мимо:** food=POOR (ожидалось LOW) — незначительно. Есть рабочие столовые.

**Уровень проблемы:** Незначительно. Industrial zone правильно идентифицирована.

---

### Кейс 18: Покровское-Стрешнево, Москва
**Адрес:** 55.8178, 37.4253 · bucket: residential  
**Что ожидалось:** retail=LOW, food=LOW, service=MEDIUM, convenience=HIGH, showroom=POOR, destination=LOW  
**Что показала модель:** retail=MEDIUM, food=HIGH, service=HIGH, convenience=HIGH, showroom=MEDIUM, destination=LOW  
**Overall verdict:** strong (ожидалось: selective) — **сильно завышено**

**Что попало правильно:** convenience=HIGH (верно! метро рядом), destination=LOW (верно).  
**Что попало мимо:**
- food=HIGH (ожидалось LOW) — **КРИТИЧНО**. Тихий жилой район с парком — не food destination.
- retail=MEDIUM (ожидалось LOW) — завышено.
- service=HIGH (ожидалось MEDIUM) — немного завышено.
- showroom=MEDIUM (ожидалось POOR) — **КРИТИЧНО**. Никакого b2b-потока в спальном районе нет.
- Overall=strong (ожидалось selective) — сильно завышено.

**Уровень проблемы:** Критично — спальный район получает такой же вердикт, как Times Square.

---

### Кейс 19: Хамовники, Москва
**Адрес:** 55.7309, 37.5783 · bucket: residential  
**Что ожидалось:** retail=LOW, food=MEDIUM, service=HIGH, convenience=HIGH, showroom=LOW, destination=LOW  
**Что показала модель:** retail=POOR, food=POOR, service=LOW, convenience=LOW, showroom=LOW, destination=LOW  
**Overall verdict:** weak (ожидалось: selective) — **полный провал в другую сторону**

**Корень проблемы:** `industrial01=0.80`. Один из самых красивых центральных жилых районов Москвы — получает verdict=weak, retail=POOR, food=POOR. Очевидно, историческая застройка / строительные объекты / что-то иное в OSM помечено как industrial.

**Уровень проблемы:** КРИТИЧНО

---

### Кейс 20: Парк Горького, Москва
**Адрес:** 55.7290, 37.6015 · bucket: destination  
**Что ожидалось:** retail=LOW, food=HIGH, service=LOW, convenience=MEDIUM, showroom=LOW, destination=HIGH  
**Что показала модель:** retail=POOR, food=POOR, service=LOW, convenience=LOW, showroom=LOW, destination=LOW  
**Overall verdict:** weak (ожидалось: selective) — **полный провал**

**Корень проблемы:** `industrial01=0.70`. Главный рекреационный парк Москвы — знаменитый ресторанами, кафе, летними кинотеатрами — получает food=POOR и verdict=weak.

**Уровень проблемы:** КРИТИЧНО

---

## 3. Повторяющиеся ошибки

### Ошибка A: false-positive industrial barrier (8 случаев из 20 — СИСТЕМНАЯ)

**Локации с ложным барьером:**
- Тверская, Москва (ind=0.70)
- Курский вокзал (ind=0.80) — ж/д инфраструктура
- Gare du Nord (ind=0.80) — ж/д инфраструктура  
- Canary Wharf (ind=0.57) — деловые башни
- Shoreditch (ind=0.80) — бывшие фабрики, джентрификация
- Хамовники (ind=0.80) — историческая застройка
- Парк Горького (ind=0.70) — парковая инфраструктура
- Невский пр-т (ind=0.47) — едва пересекает порог

**Эффект:** При `industrial01 > 0.45` весь commercial format-fit переключается в POOR/LOW. Порог 0.45 слишком низкий и не различает реальные промышленные зоны от плотной городской застройки.

### Ошибка B: flow-share saturation → всегда 0.33/0.33/0.33 (20/20 случаев — СИСТЕМНАЯ)

**Факт:** Во всех 20 кейсах: `transitShare=0.33, localActiveShare=0.33, destinationShare=0.33`.

**Причина:** В `computeFootTrafficLayer()` каждый из трёх flow-компонентов проходит через `clamp01()` независимо. При наличии 15+ магнитов разных категорий все три компонента (transit, local, destination) насыщаются до ≈1.0, и после нормализации `sum ≈ 3.0` каждая доля = 1/3.

**Эффект:** Все пороговые проверки по `transitShare`, `localActiveShare`, `destinationShare` в `buildCommercialFormatFit` не работают — они никогда не отражают реальный характер локации:
- Красная площадь = Lyubertsy = Kursky Station с точки зрения flow shares
- `destinationShare >= 0.40` для retail HIGH никогда не достигается
- `destinationShare >= 0.50` для destination HIGH никогда не достигается
- `transitShare >= 0.35` для convenience HIGH срабатывает везде

### Ошибка C: destination_venue никогда не достигает HIGH или MEDIUM (20/20 случаев)

**Факт:** Все 20 кейсов — destination_venue=LOW или POOR.

**Причина:** Комбинация двух системных ошибок:
- `destinationShare` всегда 0.33 (ошибка B) → никогда не ≥ 0.38 (порог MEDIUM) или ≥ 0.50 (HIGH)
- `demandType` почти всегда `"mixed"` → ветка `dt === 'tourism-led'` не срабатывает

Даже Red Square, Covent Garden, Times Square, Dubai Marina — все получают destination_venue=LOW.

### Ошибка D: convenience и service завышены у tourist/destination локаций

**Кейсы:** Red Square, Arbat, Covent Garden, Times Square, VDNKH, Pokrovskoye, Dubai Marina

**Причина:** Из-за flow-share saturation (ошибка B):
- `localActiveShare=0.33 >= 0.30` → service=HIGH (хотя 0.33 не означает residential context)
- `transitShare=0.33 >= 0.35` OR density=high → convenience=HIGH (срабатывает из-за density, не из-за реального transit)

Туристические точки получают service=HIGH (барбершоп на Красной площади) и convenience=HIGH (магазин у дома у вокзала Gare du Nord).

### Ошибка E: showroom завышен везде

**Кейсы:** Red Square, Arbat, Covent Garden, Times Square, VDNKH, Pokrovskoye, Dubai Marina, El Poblado

**Причина:** `scoreShowroom()` даёт MEDIUM при `destinationShare >= 0.33 || dt === 'business-led'`. Поскольку destinationShare всегда 0.33, порог 0.33 выполняется везде, и даже Красная площадь получает showroom=MEDIUM.

### Ошибка F: retail хронически занижен

**Кейсы:** Red Square, Arbat, Covent Garden, Times Square (все должны быть HIGH, получают MEDIUM)

**Причина:** `scoreRetail()` требует `destinationShare >= 0.40` для HIGH — порог никогда не достигается из-за ошибки B. Через запасные пути (`dt === 'business-led'` или `dt === 'tourism-led'`) тоже не проходит — `demandType` почти всегда `"mixed"`.

### Ошибка G: overall verdict не дифференцирован

**Примеры:**
- Покровское-Стрешнево (спальный район) = Times Square = overall=strong — одинаковый вердикт
- Тверская (главная торговая улица) = Электрозаводская (промзона) = overall=weak — одинаковый вердикт

Модель сейчас бинарная: industrial01 < 0.45 → strong; industrial01 > 0.45 → weak. Никакой реальной дифференциации нет.

---

## 4. Что работает хорошо

1. **F&B (food_beverage) при отсутствии industrial barrier** — правильно получает HIGH в локациях с реальной активностью (Moscow City, Covent Garden, Times Square). Логика F&B наименее завязана на destinationShare и работает через `flowScore = density`.

2. **Промышленные зоны идентифицированы правильно** — Электрозаводская (ind=1.00) получает корректный verdict=weak, POOR/LOW по форматам. Когда industrial01 реально высокий, это правильный ответ.

3. **Общий вердикт "strong" vs "weak" в крайних случаях** — если локация реально сильная И не засорена industrial01, или реально слабая, вердикт более-менее верный. El Poblado → selective, Moscow City → strong, Elektrozavodskaya → weak.

4. **Конкурентное давление учитывается** — `competitorPressure=high` правильно добавляет limiting factor к retail (Арбат).

5. **evergreenIndex честен** — `ev=96` у Люберец реалистично не сильно отличается от московских адресов (Overpass возвращает разные данные). Единственное "честное" дифференцирование идёт через ev<100 (El Poblado=89, Dubai=94).

---

## 5. Что ошибается

| Правило / сигнал | Проблема | Кейсов |
|---|---|---|
| `industrialBarrier()` порог 0.45 | Срабатывает для вокзалов, деловых кварталов, исторических городских улиц | 8/20 |
| `destinationShare` насыщение | Всегда 0.33, никогда не разделяет характер локации | 20/20 |
| `destination_venue` HIGH/MEDIUM недостижимы | destinationShare порог 0.38/0.50 никогда не проходят | 20/20 |
| `service=HIGH` по localActiveShare=0.33 | 0.33 не означает residential context, это артефакт насыщения | 14/20 |
| `convenience=HIGH` по density без transit-check | Срабатывает у туристических точек, где нет daily convenience flow | 12/20 |
| `showroom=MEDIUM` по destinationShare=0.33 | Порог 0.33 всегда выполняется | 15/20 |
| `retail=HIGH` недостижим | Требует destinationShare≥0.40, никогда не выполняется | 20/20 |
| `demandType='mixed'` почти всегда | tourism-led и business-led ветки почти не используются | ~18/20 |

---

## 6. Какие сигналы надо усилить

1. **Наличие attraction-магнитов как прямой признак destination** — если `hasMagnetCategory('attraction')` и `evergreenIndex >= 55`, это сильный сигнал destination_venue. Сейчас не используется в destination scoring.

2. **railway_station как усилитель convenience, а не источник industrial** — наличие railway_station должно явно повышать convenience, но через industrial01 оно его убивает.

3. **demandType tourism-led** — сигнал есть в коде, но почти никогда не trigger. Нужно понять почему. Если tourist-аудитория определяется через attraction-магниты, это должно корректно детектироваться.

4. **Кластерный контекст (clusterDetected)** — почти всегда `true` для dense urban locations. Можно использовать как положительный сигнал для destination и retail, когда cluster + attractions.

5. **Магнитный состав как прямой сигнал типа точки** — сочетание attraction + entertainment + major_hotel должно прямо указывать на destination/tourist характер локации, минуя flow-shares.

---

## 7. Какие сигналы надо ослабить

1. **industrial01 как бинарный барьер** — вместо жёсткого порога 0.45 нужно мягкое снижение с высоким потолком. Реальная промзона — ind > 0.7 при отсутствии strong-магнитов.

2. **localActiveShare как proxy для residential context** — при насыщении 0.33 это не несёт информации. Надо добавить явную residential-проверку через отсутствие destination-магнитов.

3. **density=high как достаточное условие для F&B HIGH** — пересматривать: должна требоваться также аудитория (не только плотность).

4. **destinationShare как основной различитель** — при текущем насыщении это мёртвый сигнал. Либо чинить расчёт, либо заменять на альтернативные маркеры.

---

## 8. 5–7 правок в buildCommercialFormatFit() с максимальным эффектом

> Это не полный рефакторинг, а точечные изменения, дающие максимальное улучрение.

---

### Fix 1: Поднять порог industrialBarrier с 0.45 до 0.65 (+ защита сильными магнитами)

**Что менять:** `commercial-format-fit.ts`, функция `industrialBarrier()`

**Текущий код:**
```ts
return (analysis.neighborhoodEnvironment.breakdown.industrial01 ?? 0) > 0.45;
```

**Предлагаемый код:**
```ts
const ind = analysis.neighborhoodEnvironment.breakdown.industrial01 ?? 0;
if (ind <= 0.65) return false;
// Если есть сильные магниты (metro + attraction + shopping_major), industrial не блокирует
const hasStrongUrbanMagnets = hasMagnetCategory(a, 'metro', 'railway_station', 'attraction', 'shopping_major');
return ind > 0.80 || (ind > 0.65 && !hasStrongUrbanMagnets);
```

**Почему:** Текущий порог 0.45 убивает Невский (0.47), Canary Wharf (0.57), правый берег любого оживлённого города. Реальные промзоны (Электрозаводская) имеют ind > 0.80 и нет strong-магнитов.

**Регрессионный риск:** Можно потерять часть сигнала на настоящих промзонах с магнитами. Подстраховка — требовать ind > 0.80 для жёсткого барьера.

**Кейсы, где помогает:** Тверская, Невский, Canary Wharf, Shoreditch, Хамовники, Парк Горького, Курский (частично — ind=0.80 с railway_station).

---

### Fix 2: destination_venue — добавить attraction-путь без зависимости от destinationShare

**Что менять:** `commercial-format-fit.ts`, функция `scoreDestinationVenue()`

**Текущий код:** Требует `destinationShare >= 0.50` для HIGH, `>= 0.38` для MEDIUM.

**Предлагаемый код:** Добавить альтернативный путь:
```ts
const hasAttractionCluster = nearMagnets(a, 600, 'attraction') && hasMagnetCategory(a, 'entertainment');
const hasHotelAnchor = hasMagnetCategory(a, 'major_hotel');

if (
  idx >= 65 &&
  (hasMajorAnchor || cluster) &&
  (hasAttractionCluster || hasHotelAnchor || dt === 'tourism-led') &&
  !industrial
) {
  fitLevel = 'high';
  // ... supporting factors
} else if (
  idx >= 50 &&
  (destinationShare >= 0.38 || dt === 'tourism-led' || hasAttractionCluster) &&
  !industrial
) {
  fitLevel = 'medium';
```

**Почему:** Когда в радиусе 600м есть attractions + entertainment (объективные OSM-данные), это надёжный сигнал destination без зависимости от насыщенных flow-shares.

**Регрессионный риск:** Умеренный — могут получить HIGH/MEDIUM локации с attractions, но без реального tourist-потока. Подстраховка — требовать idx >= 65 и cluster/major anchor.

**Кейсы, где помогает:** Red Square, Covent Garden, Times Square, VDNKH, Gorky Park, Dubai Marina.

---

### Fix 3: retail — разблокировать HIGH через magnet-сигналы (без destinationShare)

**Что менять:** `scoreRetail()`, ветка HIGH

**Проблема:** `destinationShare >= 0.40` никогда не достигается. Retail на Тверской, Невском, Арбате получает MEDIUM.

**Добавить условие:**
```ts
const hasRetailAnchor = hasMagnetCategory(a, 'shopping_major') || nearMagnets(a, 500, 'attraction', 'entertainment');
const hasPrimeFlow = density === 'high' && idx >= 65;

if (
  idx >= 60 &&
  hasPrimeFlow &&
  (hasShoppingAnchor || hasRetailAnchor || hasBusinessCluster) &&
  !industrial
) {
  fitLevel = 'high';
```

**Почему:** Высокий evergreenIndex + density=high + якоря — достаточные маркеры для retail HIGH без необходимости в корректном destinationShare.

**Регрессионный риск:** Незначительный — требуется ev>=60 + density=high + якоря, это отсеет слабые локации.

**Кейсы, где помогает:** Арбат, Тверская, Невский, Red Square.

---

### Fix 4: convenience — добавить tourist-exclusion; не давать HIGH при attraction-dominant context

**Что менять:** `scoreConvenience()`

**Добавить negative signal:**
```ts
const isTouristDominant = hasMagnetCategory(a, 'attraction') && !hasMagnetCategory(a, 'metro', 'railway_station');
if (isTouristDominant) {
  // туристическая аудитория не создаёт daily convenience demand
  if (fitLevel === 'high') fitLevel = 'medium';
  limiting.push('Туристический поток не формирует постоянный convenience-спрос');
}
```

**Почему:** Red Square, Arbat, Covent Garden, VDNKH — не convenience-места. Туристы не покупают ежедневные товары. Наличие attraction-магнитов без transit-hub указывает на tourist, а не utility context.

**Регрессионный риск:** Минимальный — исключение применяется только к attraction-dominant без transit.

**Кейсы, где помогает:** Red Square, Arbat, Covent Garden, Times Square (частично).

---

### Fix 5: service — требовать отсутствие tourist-dominant контекста для HIGH

**Что менять:** `scoreService()`

**Проблема:** `localActiveShare=0.33 >= 0.30` всегда даёт service=HIGH, даже на Красной площади.

**Добавить проверку:**
```ts
const isTouristContext = hasMagnetCategory(a, 'attraction') && (dt === 'tourism-led' || dt === 'mixed') && !hasMagnetCategory(a, 'business');
if (isTouristContext && fitLevel === 'high') {
  fitLevel = 'medium';
  limiting.push('Преобладает tourist-аудитория — невысокий сервисный спрос');
}
```

**Почему:** Сервисный бизнес (парикмахер, химчистка) работает для locals и business-аудитории, не для туристов.

**Регрессионный риск:** Незначительный.

**Кейсы, где помогает:** Red Square, Arbat, Covent Garden, Times Square, VDNKH.

---

### Fix 6: showroom — поднять порог destinationShare до 0.40 (или заменить на business-evidence)

**Что менять:** `scoreShowroom()`, ветка MEDIUM

**Текущий код:** `destinationShare >= 0.33 || dt === 'business-led'`

**Предлагаемый код:**
```ts
const hasBusinessEvidence = (a.audienceAnalysis?.businessClusterDetected ?? false) || dt === 'business-led';
const hasShowroomContext = hasBusinessEvidence || nearMagnets(a, 800, 'business') && idx >= 50;

} else if (
  idx >= 40 &&
  (destinationShare >= 0.40 || hasShowroomContext) &&  // поднять с 0.33 до 0.40
  !industrial
) {
  fitLevel = 'medium';
```

**Почему:** Showroom — нишевый appointment-based формат. Порог 0.33 слишком низкий — даёт MEDIUM везде, включая Красную площадь и Парк Горького. Нужно требовать либо более высокий destination или явный business-evidence.

**Регрессионный риск:** Умеренный — реальные showroom-локации с ev<40 могут потерять MEDIUM. Но это корректно.

**Кейсы, где помогает:** Red Square, Arbat, Covent Garden (убирает ложные MEDIUM).

---

### Fix 7 (бонус): Soft-cap flow components перед нормализацией

**Что менять:** `foot-traffic.ts`, функция `computeFootTrafficLayer()`

**Проблема:** `transit = clamp01(1.41 + много)` всегда → 1.0. Все три = 1.0, shares = 0.33.

**Предлагаемый подход:** Заменить `clamp01` на накопление без усечения и нормализовать в конце:
```ts
// Не clamp01 каждый компонент по отдельности, а накапливать и нормализовать вместе
let transit = Math.sqrt(accessibilityStopCount / 10);
let local = 0;
let destination = 0;

for (const m of magnets) {
  const w = magnetFlowWeights(m);
  const n = m.attractionScore / maxA;
  transit    += w.transit    * n * 0.85;
  local      += w.local      * n;
  destination+= w.destination* n;
}
// НЕ clamp01 здесь — нормализовать напрямую
const sum = transit + local + destination + 1e-4;
const transitShare    = transit    / sum;
const localActiveShare= local      / sum;
const destinationShare= destination/ sum;
```

**Почему:** Если магниты преимущественно attraction (Красная площадь), destination накопится быстрее transit и local, и destinationShare будет > 0.33 — реально отражая характер локации.

**Регрессионный риск:** Высокий — это изменение затронет весь pipeline (evergreenIndex через trafficBoost, modifierTier, все format-fit). Требует отдельного A/B тестирования. Не рекомендуется без валидации.

---

## 9. Итоговая таблица расхождений

```
Формат          | Завышен (actual > expected) | Занижен (actual < expected) | Критичных
----------------|-----------------------------|-----------------------------|----------
retail          | 0                           | 15/20                       | 8
food_beverage   | 3 (tourist locs)            | 8/20 (ind-barrier)          | 8
service         | 12/20                       | 5/20 (ind-barrier)          | 5
convenience     | 10/20                       | 6/20 (ind-barrier)          | 6
showroom        | 10/20                       | 2/20                        | 2
destination_venue| 0                          | 20/20                       | 14
```

**Ключевой вывод:** Две системные ошибки (industrial01 порог + flow saturation) порождают 90% всех критических расхождений.

---

## 10. Рекомендации к внедрению

### Немедленно (без риска регрессии):
- Fix 1: поднять industrial01 порог
- Fix 4: tourist-exclusion для convenience
- Fix 5: tourist-context для service

### После тестирования на контрольном наборе:
- Fix 2: attraction-путь для destination_venue
- Fix 3: magnet-путь для retail HIGH
- Fix 6: повышение порога showroom

### Отложить до отдельного A/B:
- Fix 7: flow saturation в foot-traffic.ts (высокий blast radius)

---

*Скрипт валидации: `scripts/commercial-format-fit-validation.ts`*  
*Данные: `scripts/commercial-format-fit-validation-results.json`*
