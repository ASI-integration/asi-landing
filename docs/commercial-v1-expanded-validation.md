# Commercial Format-Fit — Expanded V1 Validation
**Дата:** 2026-04-19  
**Метод:** Аналитическая оценка + инженерный разбор по архетипам. 20 кейсов из предыдущих прогонов + 30 новых аналитически разобранных кейсов.  
**Цель:** Понять, что движок понимает хорошо, что хрупко, что требует доработки.  
**Предыдущая валидация:** `docs/commercial-format-fit-validation.md` (20 кейсов, Fix Pass 1 + 2)

---

## 0. Контекст: что изменилось после Fix Pass 1 + 2

| Fix | Что исправлено | Эффект |
|-----|---------------|--------|
| Pass 1 — Flow-share saturation | `transitShare + localShare + destShare` больше не зажаты по [0,1] до нормализации | Туристические точки теперь правильно получают `destinationShare ≥ 0.50` |
| Pass 1 — Industrial barrier | Порог поднят 0.45 → 0.50 + metro escape hatch при 0.50–0.85 | Тверская, Невский, Kursky, Gorky Park больше не блокируются |
| Pass 2 — Showroom tourist | `touristDominant` переведён на `nearMagnets(350)` + убран мёртвый `!hasBusinessCluster` | Red Square, Covent Garden, Times Square → showroom=LOW правильно |
| Pass 2 — Convenience tourist cap | `touristCap` гейт по `destinationShare ≥ 0.50` + `railwayIsTransitContext` | Туристические точки с транзитом: convenience=MEDIUM вместо HIGH |

**После всех фиксов ожидаемое поведение:**  
- Тверская → retail/food HIGH  
- Nevsky → retail/food HIGH  
- Red Square → convenience=MEDIUM, showroom=LOW, destination=MEDIUM  
- Kursky Station → convenience HIGH  
- Gare du Nord → convenience HIGH

---

## 1. Ключевые паттерны — что модель понимает хорошо

### ✅ Стабильные выводы

| Паттерн | Пример | Вывод | Надёжность |
|---------|--------|-------|-----------|
| Dense urban business hub | Moscow-City, Canary Wharf | service/showroom HIGH | **Высокая** |
| Transit hub (метро + ж/д) | Kursky, Gare du Nord | convenience HIGH | **Высокая** |
| Tourism-destination | Covent Garden, Times Square | destination HIGH, showroom LOW | **Высокая** (после Fix 2) |
| Industrial zone | Elektrozavodskaya | все форматы POOR/LOW | **Высокая** |
| High-ev high-street | Arbat (после фикса) | retail/food HIGH | **Средняя** |
| B2B showroom corridor | Leningradsky prospect | showroom MEDIUM/HIGH | **Средняя** |
| Weak suburban | Lyubertsy outskirts | weak/poor | **Высокая** |

---

## 2. Полный набор кейсов (50 позиций)

### Блок A: High-Street Retail (городской ритейл)

---

#### A-1: Тверская улица, Москва *(исправлено Pass 1)*
**Архетип:** Main commercial spine, mixed retail  
**EV:** 100 | **industrial01:** 0.70 → после фикса escape hatch работает  
**Ожидаемый вывод (пост-фикс):** retail=HIGH, food=HIGH, service=HIGH, conv=MEDIUM, showroom=MEDIUM, dest=MEDIUM  
**Вероятный вывод модели:** ✅ retail=HIGH, food=HIGH (metro escape hatch + evergreenIndex=100)  
**Доверие:** Высокое — фикс адресован конкретно этому кейсу  
**Хрупкость:** OSM может переклассифицировать строительные объекты и снова поднять industrial01

---

#### A-2: Невский проспект, Санкт-Петербург *(исправлено Pass 1)*
**Архетип:** Iconic high street, tourist + resident mix  
**EV:** 100 | **industrial01:** ~0.47  
**Ожидаемый вывод:** retail=HIGH, food=HIGH, service=MEDIUM, conv=MEDIUM (tourist cap), showroom=LOW  
**Хрупкость:** Конкуренция за destinationShare между туристами и транзитом — может колебаться

---

#### A-3: Marais, Paris (Le Marais, Rue de Bretagne / Rue du Temple)
**Архетип:** Upscale high street, mixed retail + food + destination  
**EV:** ~90–100 | **industrial01:** ~0.20  
**Ожидаемый вывод:** retail=HIGH, food=HIGH, service=MEDIUM, conv=LOW (слабый transit+local), showroom=MEDIUM, dest=HIGH  
**Почему работает:** Attractions (museums: Centre Pompidou ~400 м), shopping_major, food cluster → правильное destination + retail  
**Известный риск:** Если `nearMagnets(350, 'attraction')` ловит Pompidou → showroom получит `touristDominant=true` → showroom=LOW. Это **правильный** вывод для Le Marais.  
**Надёжность:** Высокая

---

#### A-4: Carnaby Street, London
**Архетип:** Trendy pedestrian retail, mixed tourist + shoppers  
**EV:** ~95 | **industrial01:** ~0.25  
**Ожидаемый вывод:** retail=HIGH, food=HIGH, dest=MEDIUM, showroom=LOW (tourist), conv=LOW  
**Хрупкость:** `destinationShare` может не достичь 0.38 для dest=MEDIUM если много transit (nearby Piccadilly Circus Tube)  
**Ожидаемая проблема:** Если transitShare высокий → dest=LOW. Это несправедливо для Carnaby.

---

#### A-5: Mariahilfer Strasse, Vienna
**Архетип:** Long retail corridor, pedestrianised + transit  
**EV:** ~85 | **industrial01:** ~0.20  
**Ожидаемый вывод:** retail=HIGH, food=HIGH, service=HIGH, conv=HIGH (U-Bahn anchor)  
**Работает хорошо:** Чёткий transit + destination mix без tourist dominance — всё формулы срабатывают правильно

---

#### A-6: 5th Avenue, Midtown NYC
**Архетип:** Premium retail + high-end showroom, iconic destination  
**EV:** ~100 | **industrial01:** ~0.30  
**Ожидаемый вывод:** retail=HIGH, showroom=HIGH (business demand mid-Manhattan), dest=HIGH, food=HIGH  
**Хрупкость:** `touristDominant` может сработать если attraction (MoMA ~200 м, Empire State ~300 м) → showroom=LOW. Неправильно для 5th Ave Midtown, где B2B showrooms процветают.  
**Реальная проблема:** nearMagnets(350, 'attraction') скорее всего поймает MoMA или Empire State → showroom=LOW. **Это ошибка модели.** B2B-showrooms на 5th Ave реальны.

---

#### A-7: Кузнецкий Мост, Москва
**Архетип:** Premium boutique + art galleries + café, pedestrian  
**EV:** ~95 | **industrial01:** ~0.25  
**Ожидаемый вывод:** retail=HIGH, food=HIGH, showroom=MEDIUM, dest=MEDIUM  
**Надёжность:** Высокая — сильные anchors (GUM рядом, Большой театр, метро Кузнецкий Мост)

---

#### A-8: Покровка — Маросейка, Москва
**Архетип:** Mixed retail corridor, gentrifying, local + some tourist  
**EV:** ~80–90 | **industrial01:** ~0.20  
**Ожидаемый вывод:** retail=MEDIUM/HIGH, food=HIGH, service=MEDIUM, conv=MEDIUM  
**Хрупкость:** Если attraction рядом < 350 м (Ильинский сквер?) → showroom не даст правильную оценку

---

### Блок B: Food & Beverage Clusters (F&B кластеры)

---

#### B-1: Shoreditch, London *(исправлено Pass 1)*
**Архетип:** Dense F&B + creative cluster  
**EV:** ~100 | **industrial01:** 0.80 → до фикса: POOR. После фикса: metro escape hatch  
**Ожидаемый вывод (пост-фикс):** food=HIGH, retail=MEDIUM, dest=MEDIUM, service=HIGH  
**Доверие:** Средне-высокое — зависит от industrial01 threshold

---

#### B-2: El Poblado, Medellin *(из основной валидации)*
**Архетип:** Upscale dining + boutique cluster  
**EV:** 89 | **industrial01:** 0.17 → чистый  
**Вывод модели:** selective — food=HIGH, retail=MEDIUM  
**Правдоподобность:** ✅ Верно

---

#### B-3: Kreuzberg Berlin (Görlitzer Park-Bereich)
**Архетип:** Dense café cluster, local residential + night economy  
**EV:** ~80 | **industrial01:** ~0.30  
**Ожидаемый вывод:** food=HIGH, service=HIGH, retail=MEDIUM, conv=MEDIUM  
**Работает хорошо:** Сильный local flow (residential) + food cluster detection в движке  
**Надёжность:** Высокая

---

#### B-4: Парк Горького, Москва *(исправлено Pass 1)*
**Архетип:** Recreational destination, seasonal, destination F&B  
**EV:** ~100 | **industrial01:** ~0.70 → после фикса должен пройти  
**Ожидаемый вывод:** food=MEDIUM/HIGH, dest=HIGH, retail=LOW, service=LOW  
**Хрупкость:** industrial01=0.70 → если metro escape hatch не спасает (нет близкого метро?), всё POOR  
**Реальный риск:** Gorky Park (Парк Культуры или Октябрьская = 800+ м) → escape hatch может не сработать. Это оставшаяся ошибка.

---

#### B-5: Рубинштейна, Санкт-Петербург
**Архетип:** Iconic bar street, dense night F&B  
**EV:** ~85 | **industrial01:** ~0.20  
**Ожидаемый вывод:** food=HIGH, service=MEDIUM, retail=LOW, dest=MEDIUM  
**Надёжность:** Высокая — сильный local F&B кластер явно виден в OSM

---

#### B-6: Сретенка, Москва
**Архетип:** Street-level F&B + boutique, local pedestrian corridor  
**EV:** ~80 | **industrial01:** ~0.15  
**Ожидаемый вывод:** food=HIGH, retail=MEDIUM, service=HIGH  
**Надёжность:** Высокая

---

#### B-7: Бауманская ул., Москва
**Архетип:** Student/university corridor, lunch + affordable F&B  
**EV:** ~70 | **industrial01:** ~0.35  
**Ожидаемый вывод:** food=MEDIUM, service=MEDIUM, retail=MEDIUM, conv=MEDIUM  
**Хрупкость:** Умеренный вывод — верный для этого места

---

### Блок C: Transit Convenience (транзитные удобства)

---

#### C-1: Курский вокзал, Москва *(исправлено Pass 1)*
**Архетип:** Major transit hub, mixed convenience + food  
**EV:** ~100 | **industrial01:** ~0.80 → должен проходить через escape hatch  
**Ожидаемый вывод:** conv=HIGH, food=HIGH, retail=MEDIUM  
**Хрупкость:** При industrial01=0.80 без metro < 520 м может POOR. Метро Курская ~100–200 м → escape hatch работает

---

#### C-2: Gare du Nord, Paris *(исправлено Pass 1)*
**Архетип:** Major European transit hub  
**EV:** ~100 | **industrial01:** ~0.80 → аналогично  
**Ожидаемый вывод:** conv=HIGH, food=HIGH, service=MEDIUM  
**Доверие:** Высокое

---

#### C-3: Выхино, Москва (метро Выхино)
**Архетип:** High-transit suburban node, commuter convenience  
**EV:** ~70–80 | **industrial01:** ~0.25  
**Ожидаемый вывод:** conv=HIGH, food=MEDIUM, retail=MEDIUM, service=MEDIUM  
**Почему работает:** metro+railway anchor + высокий transitShare → правильно conv=HIGH  
**Надёжность:** Высокая

---

#### C-4: Новокузнецкая, Москва
**Архетип:** Dense pedestrian transit node, между Садовым и ЦАО  
**EV:** ~90 | **industrial01:** ~0.10  
**Ожидаемый вывод:** conv=HIGH, retail=HIGH, food=HIGH  
**Хрупкость:** Если attractions рядом → touristCap может неправильно снизить conv

---

#### C-5: Varshavskaya (Московский вокзал, Варшавская), Москва
**Архетип:** Suburban transit + local commercial  
**EV:** ~60 | **industrial01:** ~0.35  
**Ожидаемый вывод:** conv=MEDIUM/HIGH, food=MEDIUM, retail=MEDIUM  
**Надёжность:** Средняя

---

#### C-6: Митино, Москва (ТЦ рядом с метро)
**Архетип:** Suburban mall + metro end-of-line  
**EV:** ~65 | **industrial01:** ~0.15  
**Ожидаемый вывод:** conv=HIGH (metro anchor), retail=MEDIUM (mall nearby), food=MEDIUM  
**Хрупкость:** shopping_major weight даёт неправильный destinationShare если mall > 900 м

---

### Блок D: Service Corridors

---

#### D-1: Москва-Сити *(из основной валидации)*
**Архетип:** Pure business district  
**EV:** 100 | **industrial01:** 0.17  
**Вывод:** service=HIGH, showroom=HIGH ✅  
**Надёжность:** Высокая

---

#### D-2: Canary Wharf, London *(исправлено Pass 1)*
**Архетип:** Financial district, dense office + service  
**EV:** 100 | **industrial01:** 0.57 → escape hatch спасает (metro nearby)  
**Ожидаемый вывод:** service=HIGH, showroom=HIGH  
**Доверие:** Высокое

---

#### D-3: Frankfurt Bankenviertel
**Архетип:** European financial hub  
**EV:** ~95 | **industrial01:** ~0.20  
**Ожидаемый вывод:** service=HIGH, showroom=HIGH (business-led), food=HIGH  
**Надёжность:** Высокая

---

#### D-4: Хамовники, Москва *(исправлено Pass 2)*
**Архетип:** Mixed residential + business, not pure industrial  
**EV:** ~100 | **industrial01:** ~0.80 → проблема  
**После фикса:** Если metro Фрунзенская/Спортивная в пределах 900 м → escape hatch  
**Ожидаемый вывод:** service=HIGH, retail=MEDIUM  
**Хрупкость:** Оставшийся риск — industrial01=0.80 именно на границе escape hatch

---

#### D-5: Покровское-Стрешнево, Москва *(из основной валидации)*
**Архетип:** Тихий жилой район, слабый коммерческий потенциал  
**EV:** 89 | **industrial01:** 0.37  
**Проблема:** Модель давала `service=HIGH` из-за высокого localActiveShare  
**Правдоподобность:** ❌ — жилой квартал без office demand не является service-HIGH  
**Оставшийся баг:** Высокий localActiveShare (>0.30) тригерит service=HIGH, даже если аудитория чисто residential без деловой компоненты

---

#### D-6: Большой Сампсониевский пр., СПб
**Архетип:** Mixed residential-service corridor  
**EV:** ~60 | **industrial01:** ~0.25  
**Ожидаемый вывод:** service=MEDIUM, conv=MEDIUM, food=MEDIUM, retail=LOW  
**Надёжность:** Средняя

---

### Блок E: Showroom Corridors

---

#### E-1: Ленинградский пр-т (авто-шоурумы), Москва *(из основной валидации)*
**Архетип:** Auto showroom corridor  
**EV:** ~100 | **industrial01:** ~0.37  
**Вывод:** showroom=HIGH ✅  
**Надёжность:** Высокая

---

#### E-2: Варшавское шоссе (автосалоны, Москва)
**Архетип:** Auto showroom strip  
**EV:** ~80 | **industrial01:** ~0.40  
**Ожидаемый вывод:** showroom=MEDIUM/HIGH, retail=LOW, conv=LOW  
**Хрупкость:** B2B-контекст зависит от наличия business-magnets рядом

---

#### E-3: Дмитровское шоссе (Москва, мебель)
**Архетип:** Furniture/home showroom strip  
**EV:** ~65 | **industrial01:** ~0.45  
**Ожидаемый вывод:** showroom=MEDIUM, retail=LOW  
**Проблема:** industrial01 близко к порогу → риск неправильной блокировки

---

#### E-4: Olympia Design District, Miami
**Архетип:** B2B design/furniture showroom district  
**EV:** ~70 | **industrial01:** ~0.30  
**Ожидаемый вывод:** showroom=HIGH (business-led, purposeful), retail=LOW  
**Надёжность:** Средняя

---

### Блок F: Destination Venues

---

#### F-1: Красная площадь, Москва *(исправлено Pass 2)*
**Архетип:** World-class tourist destination  
**EV:** 100 | После фикса: `destinationShare=0.55+`  
**Ожидаемый вывод:** dest=MEDIUM (idx≥50, dest≥0.38, tourism-led ✓), но не HIGH (idx≥68+dest≥0.50+anchor ✓ должно быть HIGH)  
**Реальный вывод:** dest=HIGH — GUM (shopping_major) + ГИМ (attraction) + кластер → ✅  
**Надёжность:** Высокая после фикса

---

#### F-2: Covent Garden, London *(из основной валидации)*
**Архетип:** Destination shopping + entertainment  
**EV:** 100 | **Вывод:** strong ✅  
**Надёжность:** Высокая

---

#### F-3: ВДНХ, Москва *(из основной валидации)*
**Архетип:** Destination park + exhibition  
**EV:** 100 | **Вывод:** strong ✅  
**Надёжность:** Высокая

---

#### F-4: Dubai Marina
**Архетип:** Destination lifestyle + retail  
**EV:** 94 | **Вывод:** strong ✅  
**Надёжность:** Высокая

---

#### F-5: Kazan Kremlin area, Russia
**Архетип:** Региональная туристическая точка  
**EV:** ~85 | **industrial01:** ~0.15  
**Ожидаемый вывод:** dest=HIGH, retail=MEDIUM, food=HIGH (туристический поток)  
**Надёжность:** Высокая

---

#### F-6: Gorky Park Moscow *(оставшаяся проблема)*
**Архетип:** Recreational destination, seasonal  
**EV:** ~100 | **industrial01:** ~0.70  
**Ожидаемый вывод:** dest=HIGH, food=MEDIUM, retail=LOW  
**Проблема:** industrial01=0.70 без близкого метро → industrialBarrier=true → всё POOR  
**Статус:** ❌ Оставшийся баг после Pass 1/2 — нет метро в радиусе 520 м от входа (Парк Культуры ~900 м через мост)

---

#### F-7: Camden Market, London
**Архетип:** Destination market + food + entertainment  
**EV:** ~90 | **industrial01:** ~0.25  
**Ожидаемый вывод:** dest=HIGH, food=HIGH, retail=MEDIUM, conv=MEDIUM  
**Надёжность:** Высокая

---

### Блок G: Overhyped / Misleading Points

---

#### G-1: Люберцы центр *(из основной валидации)*
**Архетип:** Suburban center, inflated EV  
**EV:** 96 | **Вывод:** weak — несмотря на EV=96  
**Правдоподобность:** ✅ — слабый suburban центр правильно получает слабый коммерческий вывод  
**Надёжность:** Высокая — но пользователь может удивиться (EV высокий, вывод слабый)

---

#### G-2: Сколково, Москва (инноград)
**Архетип:** Closed tech campus, не публичная коммерческая зона  
**EV:** ~50–60 | **industrial01:** ~0.25  
**Ожидаемый вывод:** service=MEDIUM, showroom=LOW, retail=POOR, food=POOR  
**Правдоподобность:** ✅ — правильно слабый ритейл

---

#### G-3: Бутово, Москва (типовой ЖК)
**Архетип:** Чисто residential, no commercial context  
**EV:** ~40–50 | **industrial01:** ~0.10  
**Ожидаемый вывод:** service=MEDIUM (local population), conv=MEDIUM, rest=LOW  
**Проблема:** localActiveShare может быть высоким → service=HIGH неправомерно (та же проблема, что Покровское-Стрешнево)

---

#### G-4: Тула, центр города
**Архетип:** Региональный областной центр, слабый коммерческий контекст  
**EV:** ~70 | **industrial01:** ~0.25  
**Ожидаемый вывод:** retail=MEDIUM, food=MEDIUM, dest=LOW  
**Хрупкость:** Движок может дать HIGH из-за слабой нормализации региональных anchors

---

#### G-5: Рублёвское шоссе (жилой сегмент, не ТЦ)
**Архетип:** Affluent residential, minimal street-level commerce  
**EV:** ~40 | **industrial01:** ~0.05  
**Ожидаемый вывод:** service=LOW, conv=LOW, rest=POOR  
**Хрупкость:** Если hospital или бизнес рядом → ложный service=HIGH

---

### Блок H: Weak / Residential-Only Points

---

#### H-1: Чертаново, Москва (глубокий жилой массив)
**Архетип:** Спальный район, далеко от метро  
**EV:** ~30–40 | **industrial01:** ~0.10  
**Ожидаемый вывод:** conv=LOW, service=LOW, rest=POOR  
**Надёжность:** Высокая

---

#### H-2: Электрозаводская, Москва *(из основной валидации)*
**Архетип:** True industrial zone  
**EV:** ~100 | **industrial01:** 1.00  
**Вывод:** все форматы POOR/LOW ✅  
**Надёжность:** Высокая — правильный результат

---

#### H-3: Переславль-Залесский центр
**Архетип:** Малый город, слабый коммерческий потенциал  
**EV:** ~9 | **industrial01:** ~0.10  
**Ожидаемый вывод:** все POOR  
**Надёжность:** Высокая

---

#### H-4: Поселение Московский (ТиНАО)
**Архетип:** Новая застройка, слабая инфраструктура  
**EV:** ~35 | **industrial01:** ~0.20  
**Ожидаемый вывод:** conv=MEDIUM, service=LOW, rest=POOR  
**Хрупкость:** Если метро Коммунарка рядом → conv=HIGH (правильно)

---

### Блок I: Business-Heavy Points (B2B контекст)

---

#### I-1: Дмитровка (бизнес-центры, Москва)
**Архетип:** Dense office cluster, B2B showroom viable  
**EV:** ~95 | **industrial01:** ~0.20  
**Ожидаемый вывод:** showroom=HIGH, service=HIGH, food=HIGH  
**Надёжность:** Высокая

---

#### I-2: Пресня (Новинский бульвар), Москва
**Архетип:** Mixed business + residential + embassy zone  
**EV:** ~90 | **industrial01:** ~0.20  
**Ожидаемый вывод:** service=HIGH, showroom=MEDIUM, food=HIGH  
**Надёжность:** Высокая

---

#### I-3: Шоссе Энтузиастов (логистика + производство)
**Архетип:** Mixed logistics + office, высокий industrial01  
**EV:** ~70 | **industrial01:** ~0.65  
**Ожидаемый вывод:** service=LOW, showroom=LOW, rest=POOR  
**Надёжность:** Высокая — правильно слабый потребительский контекст

---

### Блок J: Tourist-Heavy Points (дополнительные)

---

#### J-1: Times Square, NYC *(из основной валидации)*
**EV:** 100 | **Вывод:** strong ✅  

---

#### J-2: Арбат, Москва *(исправлено)*
**Архетип:** Tourist pedestrian street  
**Ожидаемый вывод (пост-фикс):** retail=HIGH, food=HIGH, conv=MEDIUM (tourist cap), showroom=LOW ✅  

---

#### J-3: Montmartre, Paris
**Архетип:** Pure tourist destination  
**EV:** ~90 | **industrial01:** ~0.15  
**Ожидаемый вывод:** dest=HIGH, food=HIGH, retail=MEDIUM, conv=LOW (tourist cap), showroom=LOW  
**Надёжность:** Высокая

---

#### J-4: Экономика Красного Поля — La Boqueria, Barcelona
**Архетип:** Market destination, tourist + local  
**EV:** ~95 | **industrial01:** ~0.10  
**Ожидаемый вывод:** dest=HIGH, food=HIGH, retail=MEDIUM  
**Хрупкость:** В пешеходной зоне Ramblas transitShare будет высоким → conv может получить ложный HIGH

---

---

## 3. Сводная таблица по архетипам

| Архетип | Надёжность | Типичная проблема |
|---------|-----------|-------------------|
| Dense urban business hub | **Высокая** | — |
| Transit hub | **Высокая** | Только если industrial01 не блокирует |
| Tourist destination | **Средне-высокая** | nearMagnets(350) может не поймать все anchors |
| Industrial true | **Высокая** | — |
| High-street retail | **Средняя** | industrial01 нестабилен при OSM noise |
| F&B cluster | **Средняя** | food cluster detection чувствителен к точкам |
| Showroom corridor | **Средняя** | B2B-контекст зависит от business-magnet наличия |
| Destination venue | **Средняя** | destinationShare пороги чувствительны |
| Weak suburban | **Высокая** | Может дать HIGH при residential local flow |
| Residential only | **Средняя** | service=HIGH ложный при high localActiveShare |

---

## 4. Повторяющиеся ошибки

### Ошибка 1: `service=HIGH` в жилых районах без деловой аудитории
**Корень:** `localActiveShare >= 0.30` используется как прокси residential, но в движке это тригер service=HIGH
**Примеры:** Покровское-Стрешнево, Бутово  
**Вывод:** Нужен дополнительный guard — business-demand отсутствует и `dt !== 'business-led'` → понижать до MEDIUM

### Ошибка 2: `destination_venue` не достигает HIGH на средних туристических точках
**Корень:** `idx >= 68 && dest >= 0.50 && hasMajorAnchor` — порог HIGH жёсткий  
**Примеры:** Carnaby, Gorky Park (если пройдёт industrial), Montmartre  
**Вывод:** Рассмотреть понижение до `idx >= 60 && dest >= 0.44`

### Ошибка 3: `industrial01` нестабилен при OSM noise
**Корень:** OSM-тегирование непредсказуемо: строительные объекты, технические здания, старые заводы в центре города
**Примеры:** Тверская, Хамовники, Shoreditch  
**Вывод:** Escape hatch уже есть, но 0.85 верхний порог может быть слишком жёстким

### Ошибка 4: `touristCap` в convenience может быть слишком агрессивным
**Корень:** Railway + tourist → `railwayIsTransitContext` — работает, но пограничные случаи (Camden, Covent Garden с Victoria Line)
**Примеры:** Pешения, где есть ж/д < 400 м от tourist zone  
**Вывод:** Мониторить пограничные кейсы

### Ошибка 5: Showroom=HIGH на 5th Ave / премиальных улицах с attractions
**Корень:** nearMagnets(350, 'attraction') ловит музеи → touristDominant → showroom=LOW
**Примеры:** 5th Ave (MoMA, Empire State), Via Montenapoleone Milan  
**Вывод:** Нужен guard: если `dt === 'business-led' && idx >= 80` → tourist-override не срабатывает

---

## 5. Сигналы с высокой надёжностью

| Сигнал | Что определяет | Надёжность |
|--------|----------------|-----------|
| `evergreenIndex >= 60` + `metro` | Urban commercial grade | Высокая |
| `industrialBarrier=true` (ind01 > 0.85) | Блокировка | Высокая |
| `dt === 'transport-led'` | Transit hub context | Высокая |
| `transitShare >= 0.35 + metro` | Convenience-HIGH trigger | Высокая |
| `hasBusinessCluster + dt=business-led` | Showroom-HIGH gate | Высокая |
| `nearMagnets(350, attraction) + dest >= 0.50` | Tourist-dominant | Средне-высокая |
| `localActiveShare >= 0.30` | Service trigger | Средняя (ложные срабатывания) |
| `destinationShare >= 0.50 && dt=tourism-led` | Tourism-cap | Средняя |

---

## 6. Сигналы с низкой надёжностью

| Сигнал | Проблема |
|--------|----------|
| `industrial01` (0.50–0.85 зона) | OSM noise — нестабильный |
| `destinationShare >= 0.50` для HIGH destination | Бывает 0.44–0.49 на сильных destination-точках |
| `localActiveShare >= 0.30` как residential proxy | Нет разницы residential vs. business local |
| food cluster (5+ в 220 м) | Работает только в плотных F&B кварталах |
| `hasMajorAnchor` для destination HIGH | shopping_major может быть далеко |

---

## 7. Итог: что движок уже понимает хорошо

- Dense business hubs (service, showroom)
- Чистые transit hubs (convenience)
- Чистые tourist destinations (избегает showroom, даёт destination)
- True industrial zones (правильная блокировка)
- Weak suburban / no-context locations

## 8. Что остаётся хрупким

- Residential-only locations → ложный service=HIGH
- High-street retail при OSM industrial noise
- Destination venues с умеренным потоком (ниже жёстких порогов)
- Showroom на улицах с attractions + B2B context
- Gorky Park / recreational parks вдали от метро

---

*Следующий шаг: `docs/commercial-format-fit-v1-tuning-plan.md`*
