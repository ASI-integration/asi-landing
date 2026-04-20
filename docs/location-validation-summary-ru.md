# Location Intelligence — Итоговый отчёт валидации (100 кейсов)

> Данные: Overpass API, апрель 2026 · Подробные карточки: `docs/location-validation-100-cards.md`

---

## 1. Общее распределение

| Бэнд | Кейсов | Доля |
|------|--------|------|
| strong (idx ≥ 70) | 49 | **49%** |
| medium (idx 45–69) | 18 | **18%** |
| weak (idx < 45) | 33 | **33%** |

**33 кейса (33%) упёрлись в потолок idx=100** — включая Times Square, Shinjuku, Tromsø, Ozone Park Queens и Переславль-Залесский.

Среди 49 сильных кейсов реально сильными (неоспоримо) являются порядка 30–33; остальные 16–19 — артефакты завышения.

---

## 2. Типы локаций: завышение vs занижение

### Систематически завышаются

| Тип | Примеры | Причина |
|-----|---------|---------|
| **weak_suburb** | Ozone Park (100) | airport radius 3500м |
| **remote** | Tromsø (100) | airport radius — 3 аэропорта в 3.5км |
| **rural** | Переславль (100) | плотность офисных нотариальных POI |
| **weak_urban** | Wedding Berlin (100), Podgorica (100) | metro inflation |
| **small_weak_city** | Кострома (77) | офисы гор. администрации |
| **medium_urban (спальный)** | Prenzlauer Berg (100), Palermo (100), Surry Hills (100) | office noise |

### Систематически занижаются

| Тип | Примеры | Причина |
|-----|---------|---------|
| **strong_urban (Азия/СНГ)** | Causeway Bay (6), Казань (5), Kadıköy (16), Алматы (16), Baku (15) | OSM-мисматч metro-тегов |
| **beach_resort** | Pattaya (31), Copacabana (36), Сочи (22) | нет luxury hotel recognition, competitor pressure |
| **ski_mountain** | Courchevel (24), Красная Поляна (5), Siena (5) | нет ski-POI, конкуренция убивает |
| **convention** | Экспоцентр (18), LV Conv Ctr (29) | amenity теги не распознаны |
| **transport (airport)** | Frankfurt (20), Dubai Airport (16) | airport отдалён от точки |
| **historic towns** | Siena (5), Quartieri Spagnoli (5), Baku (15) | конкуренция + 0 attraction |
| **American cities no metro** | Austin (23), Brickell (32) | нет subway infrastructure |

---

## 3. Ceiling effect: кейсы с idx=100

33 кейса достигли потолка. Из них:

**Правдоподобно strong (≈ должны быть в топе):**
Times Square, Shinjuku, Covent Garden, Opéra Paris, Арбат, Praça da Sé, Taksim,
Eixample, King's Cross, Тбилиси Ст. Город, Mykonos, Minsk Prospekt, Zagreb, 
Екатеринбург, Новосибирск, River North Chicago, Zona Rosa CDMX, Miraflores Lima,
Sandton CBD, Hanoi, Chiang Mai, Thamel, Zamalek

**Сомнительно ceiling (должны быть ниже):**
Ozone Park, Tromsø, Переславль-Залесский, Wedding Berlin, Podgorica, Surry Hills,
Ciudad Vieja Montevideo, Valletta, Palermo Buenos Aires, Кострома (77)

---

## 4. Десять самых подозрительных кейсов

| # | Кейс | Результат | Ожидание | Проблема |
|---|------|-----------|----------|---------|
| 1 | Causeway Bay (HK) | weak/6 | strong | HK MTR не распознан |
| 2 | Казань центр | weak/5 | strong | metro/attraction пусто |
| 3 | Ozone Park (Queens) | strong/100 | weak | airport radius bug |
| 4 | Tromsø | strong/100 | medium | airport radius bug |
| 5 | Siena old town | weak/5 | medium | 100 конкурентов, 0 attraction |
| 6 | Переславль-Залесский | strong/100 | weak | office noise (нотариусы) |
| 7 | Wedding Berlin | strong/100 | weak | metro inflation |
| 8 | El Poblado Medellín | weak/5 | medium | 0 metro + 74 конкурента |
| 9 | Quartieri Spagnoli Naples | weak/5 | medium | 52 конкурента, 0 attraction |
| 10 | Brickell Miami | weak/32 | strong | sparse OSM, metro far |

---

## 5. Десять самых правдоподобных кейсов

| # | Кейс | Результат | Почему правдоподобно |
|---|------|-----------|---------------------|
| 1 | Cannes Croisette | strong/73 | дифференцирован, не ceiling |
| 2 | Davos Platz | medium/58 | luxury hotels + convention |
| 3 | Las Vegas Strip | strong/95 | attractions + хорошая тонкость |
| 4 | Clapham Common | medium/64 | metro, лондонский жилой |
| 5 | 20ème Paris | medium/61 | metro-driven, логично |
| 6 | KLCC Bukit Bintang | strong/75 | metro + major_hotels |
| 7 | Fitzroy Melbourne | medium/59 | сбалансированный вывод |
| 8 | Queenstown | medium/50 | attractions + hotels |
| 9 | Сеченов. кластер | strong/89 | cluster + metro |
| 10 | Beaune | medium/52 | small historic city, верно |

---

## 6. Ключевые системные проблемы

### P1 — Ceiling effect (критично)
33% кейсов = 100. Шкала сжата: нет разницы между Times Square и Ozone Park Queens.

### P2 — Airport radius 3500м (критично)
Любая локация в 3500м от аэропорта получает +8 к весу. Это убивает дифференциацию в жилых зонах вблизи аэропортов (Ozone Park, Tromsø, Mykonos, Beaune). При этом сами аэропортные зоны = weak, потому что точка координат не там, где runway.

### P3 — OSM metro-мисматч (критично, Азия/СНГ)
HK MTR, Tokyo metro-входы (частично), Kazakh metro, Stockholm T-Bana, Medellin metro — не распознаются как `railway=subway_entrance`. Результат: idx=6 для Causeway Bay.

### P4 — Competitor pressure как враг туристических локаций (критично)
Плотные туристические зоны с hotel-конкурентами (Siena, Quartieri Spagnoli, Copacabana, El Poblado) получают максимальный competitorPressure=20, который обнуляет всю привлекательность.

### P5 — Office noise (средне)
OSM-офисные POI в странах с хорошей деловой картографией (Германия, Россия, Испания) искусственно раздувают business-категорию, создавая сильных магнитов там, где их нет (Wedding Berlin, Переславль, Prenzlauer Berg).

### P6 — Sparse OSM для развивающихся рынков (средне)
ОАЭ, Китай (вне хабов), Казахстан, Азербайджан, Африка, Латинская Америка — 12–40 элементов вместо ожидаемых 100+.

### P7 — Ski/resort как слепое пятно (средне)
Ski-локации не имеют специфических магнитов (ski lifts, пiste, chalet). Courchevel 1850 = weak/24.

### P8 — Города без метро (США без subway) (средне)
Austin (23), Denver Cherry Creek (завышен по-другому) — модель слепа к городам без subway infrastructure даже при высоком bus_stop count.

---

## 7. Вывод: можно ли использовать как публичную демо-функцию?

**Ответ: ограниченно, с оговорками.**

**Что работает:**
- Сильные western-European и american metro-города (Париж, Лондон, Нью-Йорк, Барселона, Берлин-центр, Рим) — надёжно strong
- Деловые кварталы с luxury hotel + metro mix (Cannes, Davos, Las Vegas Strip) — хорошая дифференциация
- Слабые локации (промзоны, пригороды без инфраструктуры) — правдоподобно weak

**Что нельзя показывать:**
- Любые азиатские мегаполисы (HK, Tokyo metro edge, Beijing) — данные ненадёжны
- Турецкие/казахские/постсоветские города — metro-мисматч
- Ski-курорты (Courchevel — позор)
- Исторические centro storico без luxury hotels (Siena, Quartieri Spagnoli)
- Пляжные курорты без luxury chains в OSM (Pattaya, Copacabana, Красная Поляна)
- Любые американские города без subway (Austin, Miami Brickell — sparse)

**Рекомендация:** показывать демо только на западноевропейских и крупных американских metro-городах; добавить явный disclaimer «данные OSM могут быть неполными» для других регионов; исправить airport radius до запуска.
