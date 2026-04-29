# Каноническая калибровочная матрица RU: жилые локации (50 бенчмарков)

Этот документ — **канонический набор бенчмарков** для регрессионной проверки валидации RU‑локаций (жилой сценарий / demo sanity).

## Зачем это нужно

- **Канонично**: этот список является единой точкой правды для регрессионных тестов.
- **Не «захардкоженные ответы»**: матрица фиксирует *ожидания продукта* (диапазоны, аудитория, запреты), а не подменяет расчёт.  
- **Защита от регрессий**: любое изменение скоринга/правил/классификации должно проходить эту матрицу.

## Архетипы, которые должны быть покрыты

- premium city center
- tourist center
- business center
- metro residential
- ordinary residential
- weak residential edge
- secondary magnet cluster
- hospital cluster
- university cluster
- railway station
- airport
- resort city
- beach resort
- mountain resort
- satellite town
- village / settlement
- industrial edge
- waterfront urban area
- low competition niche
- high competition saturated area

## Формат ожиданий

- **Score band**: weak / moderate / strong / premium
- **Numeric range**: например `35–55` (ожидаемый коридор презентационного индекса)
- **Expected audience**: residential / mixed / business / tourist / resort / corporate
- **must_not_happen**: запреты на вывод/вердикт/аудиторию (регрессионные «красные флаги»)

---

## 50 эталонных локаций

### 1) Санкт-Петербург — Комендантский проспект, 23к1 (обязательный кейс)
- **Address**: Санкт-Петербург, Комендантский проспект, 23к1
- **City/Region**: Санкт‑Петербург
- **Archetype**: metro residential
- **Expected score band**: moderate
- **Expected numeric range**: 55–75
- **Expected audience**: mixed
- **must_not_happen**:
  - «Сильная локация для командированных»
  - BUSINESS как единственная аудитория при «банки/страховые/офисы продаж»
- **Rationale (RU)**: Спальный район с метро и торговыми точками; деловой спрос возможен как примесь, но не должен становиться «сильной командировочной» без реальных деловых магнитов.

### 2) Санкт-Петербург — Большeохтинский проспект, 5/10к1 (обязательный кейс)
- **Address**: Санкт-Петербург, Большeохтинский проспект, 5/10к1
- **City/Region**: Санкт‑Петербург
- **Archetype**: secondary magnet cluster
- **Expected score band**: moderate
- **Expected numeric range**: 35–55
- **Expected audience**: mixed
- **must_not_happen**:
  - near-zero (≤ 10) при наличии нескольких «вторичных» магнитов
  - «Сильная туристическая локация»
- **Rationale (RU)**: Локальный районный кластер (админ/сервис/питание/частично транспорт) должен выглядеть «умеренно», а не схлопываться в 5/100.

### 3) Санкт-Петербург — Невский проспект, 28 (обязательный кейс)
- **Address**: Санкт-Петербург, Невский проспект, 28
- **City/Region**: Санкт‑Петербург
- **Archetype**: tourist center
- **Expected score band**: premium
- **Expected numeric range**: 80–100
- **Expected audience**: tourist
- **must_not_happen**:
  - weak / moderate вердикт при явной центральной туристической зоне
- **Rationale (RU)**: Ядро туристического спроса с высокой насыщенностью достопримечательностей/транспорта/сервиса.

### 4) Санкт-Петербург — улица Маяковского, 6 (обязательный кейс)
- **Address**: Санкт-Петербург, улица Маяковского, 6
- **City/Region**: Санкт‑Петербург
- **Archetype**: premium city center
- **Expected score band**: premium
- **Expected numeric range**: 75–95
- **Expected audience**: mixed
- **must_not_happen**:
  - «Слабый спрос — нужен точечный сценарий»
- **Rationale (RU)**: Центральная городская ткань, близко к транспорту и притяжениям; аудитория смешанная.

### 5) Москва — Пресненская набережная, 12 (обязательный кейс)
- **Address**: Москва, Пресненская набережная, 12
- **City/Region**: Москва
- **Archetype**: business center
- **Expected score band**: premium
- **Expected numeric range**: 80–100
- **Expected audience**: corporate
- **must_not_happen**:
  - residential как единственная аудитория
- **Rationale (RU)**: Ярко выраженный деловой центр (Moscow City), высокий командировочный спрос.

### 6) Москва — Тверская улица, 7 (обязательный кейс)
- **Address**: Москва, Тверская улица, 7
- **City/Region**: Москва
- **Archetype**: premium city center
- **Expected score band**: premium
- **Expected numeric range**: 80–100
- **Expected audience**: mixed
- **must_not_happen**:
  - near-zero / weak
- **Rationale (RU)**: Центр Москвы, высокий общий спрос (город/туризм/командировки).

### 7) Екатеринбург — улица Малышева, 51 (обязательный кейс)
- **Address**: Екатеринбург, улица Малышева, 51
- **City/Region**: Свердловская область
- **Archetype**: business center
- **Expected score band**: strong
- **Expected numeric range**: 70–90
- **Expected audience**: business
- **must_not_happen**:
  - «Обычная жилая локация…» при реальном центральном деловом контексте
- **Rationale (RU)**: Центральная ось города, рабочие поездки и сервисный спрос.

### 8) Казань — улица Баумана, 21 (обязательный кейс)
- **Address**: Казань, улица Баумана, 21
- **City/Region**: Татарстан
- **Archetype**: tourist center
- **Expected score band**: strong
- **Expected numeric range**: 70–90
- **Expected audience**: tourist
- **must_not_happen**:
  - weak (≤ 25) из-за «пустого OSM»
- **Rationale (RU)**: Главная пешеходная туристическая улица, устойчивый туристический поток.

### 9) Сочи — Курортный проспект, 50 (обязательный кейс)
- **Address**: Сочи, Курортный проспект, 50
- **City/Region**: Краснодарский край
- **Archetype**: resort city
- **Expected score band**: strong
- **Expected numeric range**: 65–90
- **Expected audience**: resort
- **must_not_happen**:
  - near-zero / weak при курортной центральной оси
- **Rationale (RU)**: Курортный спрос (сезонный), туристические и сервисные магниты.

### 10) Анапа — Пионерский проспект, 20 (обязательный кейс)
- **Address**: Анапа, Пионерский проспект, 20
- **City/Region**: Краснодарский край
- **Archetype**: beach resort
- **Expected score band**: moderate
- **Expected numeric range**: 45–75
- **Expected audience**: resort
- **must_not_happen**:
  - «Сильная локация для командированных»
- **Rationale (RU)**: Пляжная курортная полоса: высокая сезонность, аудитория «resort».

### 11) Всеволожск — Колтушское шоссе, 44 (обязательный кейс)
- **Address**: Всеволожск, Колтушское шоссе, 44
- **City/Region**: Ленинградская область
- **Archetype**: satellite town
- **Expected score band**: weak
- **Expected numeric range**: 25–45
- **Expected audience**: residential
- **must_not_happen**:
  - premium/strong без сильных магнитов
- **Rationale (RU)**: Спутник мегаполиса; спрос ограничен локальными факторами.

### 12) Горелово — Красносельское шоссе, 50 (обязательный кейс)
- **Address**: Горелово, Красносельское шоссе, 50
- **City/Region**: Ленинградская область (посёлок)
- **Archetype**: weak residential edge
- **Expected score band**: weak
- **Expected numeric range**: 15–35
- **Expected audience**: residential
- **must_not_happen**:
  - strong из-за «шума офисов»
- **Rationale (RU)**: Периферия/край городской застройки; слабый спрос на краткосрок.

### 13) Шерегеш — улица Гагарина, 12 (обязательный кейс)
- **Address**: Шерегеш, улица Гагарина, 12
- **City/Region**: Кемеровская область
- **Archetype**: mountain resort
- **Expected score band**: moderate
- **Expected numeric range**: 40–70
- **Expected audience**: resort
- **must_not_happen**:
  - near-zero при очевидном горнолыжном контексте
- **Rationale (RU)**: Горный курорт (сезонный), спрос «resort», не «business».

---
### 14) Санкт-Петербург — Лиговский проспект, 50
- **Address**: Санкт-Петербург, Лиговский проспект, 50
- **City/Region**: Санкт‑Петербург
- **Archetype**: railway station
- **Expected score band**: strong
- **Expected numeric range**: 70–90
- **Expected audience**: business
- **must_not_happen**: near-zero
- **Rationale (RU)**: Транспортный узел (вокзал) формирует командировочный и транзитный спрос.

### 15) Москва — Киевский вокзал, площадь Киевского Вокзала, 1
- **Address**: Москва, площадь Киевского Вокзала, 1
- **City/Region**: Москва
- **Archetype**: railway station
- **Expected score band**: strong
- **Expected numeric range**: 70–95
- **Expected audience**: business
- **must_not_happen**: weak
- **Rationale (RU)**: Вокзал + деловой/городской контекст вокруг.

### 16) Москва — Аэропорт Шереметьево (терминал B)
- **Address**: Москва, Аэропорт Шереметьево, терминал B
- **City/Region**: Московская область
- **Archetype**: airport
- **Expected score band**: moderate
- **Expected numeric range**: 45–75
- **Expected audience**: corporate
- **must_not_happen**:
  - premium «туристическая локация»
- **Rationale (RU)**: Аэропортовый спрос часто корпоративный/транзитный, но сама зона не обязана быть premium.

### 17) Санкт-Петербург — Аэропорт Пулково, 1
- **Address**: Санкт-Петербург, Аэропорт Пулково, 1
- **City/Region**: Санкт‑Петербург
- **Archetype**: airport
- **Expected score band**: moderate
- **Expected numeric range**: 40–70
- **Expected audience**: corporate
- **must_not_happen**: premium/туристическая
- **Rationale (RU)**: Транзит/командировки; важно не завышать периферию «по радиусу».

### 18) Москва — Арбат, 1
- **Address**: Москва, улица Арбат, 1
- **City/Region**: Москва
- **Archetype**: tourist center
- **Expected score band**: premium
- **Expected numeric range**: 80–100
- **Expected audience**: tourist
- **must_not_happen**: weak
- **Rationale (RU)**: Плотный туристический центр.

### 19) Санкт-Петербург — Дворцовая площадь, 2
- **Address**: Санкт-Петербург, Дворцовая площадь, 2
- **City/Region**: Санкт‑Петербург
- **Archetype**: tourist center
- **Expected score band**: premium
- **Expected numeric range**: 85–100
- **Expected audience**: tourist
- **must_not_happen**: moderate/weak
- **Rationale (RU)**: Главные достопримечательности и поток туристов.

### 20) Нижний Новгород — Большая Покровская улица, 2
- **Address**: Нижний Новгород, Большая Покровская улица, 2
- **City/Region**: Нижегородская область
- **Archetype**: tourist center
- **Expected score band**: strong
- **Expected numeric range**: 70–90
- **Expected audience**: tourist
- **must_not_happen**: weak
- **Rationale (RU)**: Центр, пешеходная активность и туризм.

### 21) Новосибирск — Красный проспект, 25
- **Address**: Новосибирск, Красный проспект, 25
- **City/Region**: Новосибирская область
- **Archetype**: business center
- **Expected score band**: strong
- **Expected numeric range**: 65–90
- **Expected audience**: business
- **must_not_happen**: residential-only
- **Rationale (RU)**: Центральный деловой коридор, сервис и трафик.

### 22) Ростов-на-Дону — Большая Садовая улица, 50
- **Address**: Ростов-на-Дону, Большая Садовая улица, 50
- **City/Region**: Ростовская область
- **Archetype**: business center
- **Expected score band**: strong
- **Expected numeric range**: 65–90
- **Expected audience**: mixed
- **must_not_happen**: weak
- **Rationale (RU)**: Центр города, смешанный спрос.

### 23) Самара — Ленинградская улица, 25
- **Address**: Самара, Ленинградская улица, 25
- **City/Region**: Самарская область
- **Archetype**: tourist center
- **Expected score band**: strong
- **Expected numeric range**: 65–90
- **Expected audience**: mixed
- **must_not_happen**: weak
- **Rationale (RU)**: Центральная пешеходная зона, городская активность.

### 24) Калининград — Ленинский проспект, 30
- **Address**: Калининград, Ленинский проспект, 30
- **City/Region**: Калининградская область
- **Archetype**: waterfront urban area
- **Expected score band**: moderate
- **Expected numeric range**: 55–80
- **Expected audience**: mixed
- **must_not_happen**: near-zero
- **Rationale (RU)**: Городская набережная/центр: прогулочный и туристический контекст, но без гарантий premium.

### 25) Владивосток — Светланская улица, 33
- **Address**: Владивосток, Светланская улица, 33
- **City/Region**: Приморский край
- **Archetype**: waterfront urban area
- **Expected score band**: moderate
- **Expected numeric range**: 55–80
- **Expected audience**: mixed
- **must_not_happen**: weak при центре
- **Rationale (RU)**: Центр портового города, смешанный спрос.

### 26) Санкт-Петербург — Васильевский остров, набережная Макарова, 10
- **Address**: Санкт-Петербург, набережная Макарова, 10
- **City/Region**: Санкт‑Петербург
- **Archetype**: waterfront urban area
- **Expected score band**: strong
- **Expected numeric range**: 65–90
- **Expected audience**: mixed
- **must_not_happen**: weak
- **Rationale (RU)**: Набережная в центральной зоне с хорошей доступностью.

### 27) Москва — Хамовники, Комсомольский проспект, 28
- **Address**: Москва, Комсомольский проспект, 28
- **City/Region**: Москва
- **Archetype**: premium city center
- **Expected score band**: premium
- **Expected numeric range**: 75–95
- **Expected audience**: mixed
- **must_not_happen**: weak
- **Rationale (RU)**: Дорогой центральный жилой район с сильной городской инфраструктурой.

### 28) Санкт-Петербург — Петроградская сторона, Большой проспект П.С., 35
- **Address**: Санкт-Петербург, Большой проспект П.С., 35
- **City/Region**: Санкт‑Петербург
- **Archetype**: premium city center
- **Expected score band**: premium
- **Expected numeric range**: 75–95
- **Expected audience**: mixed
- **must_not_happen**: weak
- **Rationale (RU)**: Центральная плотная ткань, устойчивый спрос.

### 29) Москва — район Марьино, Люблинская улица, 153
- **Address**: Москва, Люблинская улица, 153
- **City/Region**: Москва
- **Archetype**: metro residential
- **Expected score band**: moderate
- **Expected numeric range**: 45–70
- **Expected audience**: residential
- **must_not_happen**: «Сильная локация для командированных»
- **Rationale (RU)**: Типичный спальный район: метро/инфраструктура есть, но деловой/туристический профиль не доминирует.

### 30) Москва — район Некрасовка, улица Недорубова, 15
- **Address**: Москва, улица Недорубова, 15
- **City/Region**: Москва
- **Archetype**: ordinary residential
- **Expected score band**: weak
- **Expected numeric range**: 25–50
- **Expected audience**: residential
- **must_not_happen**: premium
- **Rationale (RU)**: Обычная жилая периферия, спрос ограничен.

### 31) Санкт-Петербург — Купчино, Бухарестская улица, 130
- **Address**: Санкт-Петербург, Бухарестская улица, 130
- **City/Region**: Санкт‑Петербург
- **Archetype**: ordinary residential
- **Expected score band**: weak
- **Expected numeric range**: 25–50
- **Expected audience**: residential
- **must_not_happen**: strong
- **Rationale (RU)**: Спальный район без крупных магнитов.

### 32) Екатеринбург — Уралмаш, улица Бакинских Комиссаров, 100
- **Address**: Екатеринбург, улица Бакинских Комиссаров, 100
- **City/Region**: Свердловская область
- **Archetype**: ordinary residential
- **Expected score band**: weak
- **Expected numeric range**: 20–45
- **Expected audience**: residential
- **must_not_happen**: strong business
- **Rationale (RU)**: Жилая зона, ограниченный спрос, деловой профиль не подтверждён.

### 33) Казань — Азино, Проспект Победы, 180
- **Address**: Казань, проспект Победы, 180
- **City/Region**: Татарстан
- **Archetype**: ordinary residential
- **Expected score band**: weak
- **Expected numeric range**: 20–45
- **Expected audience**: residential
- **must_not_happen**: tourist
- **Rationale (RU)**: Обычная жилая зона вне туристического ядра.

### 34) Челябинск — Комсомольский проспект, 80
- **Address**: Челябинск, Комсомольский проспект, 80
- **City/Region**: Челябинская область
- **Archetype**: weak residential edge
- **Expected score band**: weak
- **Expected numeric range**: 15–40
- **Expected audience**: residential
- **must_not_happen**: premium
- **Rationale (RU)**: Периферийная ось/край, спрос слабый.

### 35) Омск — проспект Мира, 150
- **Address**: Омск, проспект Мира, 150
- **City/Region**: Омская область
- **Archetype**: weak residential edge
- **Expected score band**: weak
- **Expected numeric range**: 15–40
- **Expected audience**: residential
- **must_not_happen**: strong
- **Rationale (RU)**: Край городской застройки, слабый краткосрок.

### 36) Пермь — улица Ленина, 68
- **Address**: Пермь, улица Ленина, 68
- **City/Region**: Пермский край
- **Archetype**: business center
- **Expected score band**: strong
- **Expected numeric range**: 65–90
- **Expected audience**: mixed
- **must_not_happen**: weak
- **Rationale (RU)**: Центральный коридор города, смешанный спрос.

### 37) Томск — проспект Ленина, 36
- **Address**: Томск, проспект Ленина, 36
- **City/Region**: Томская область
- **Archetype**: university cluster
- **Expected score band**: strong
- **Expected numeric range**: 60–85
- **Expected audience**: mixed
- **must_not_happen**: near-zero
- **Rationale (RU)**: Университетский город, устойчивый спрос вокруг кампусов.

### 38) Новосибирск — Академгородок, проспект Академика Лаврентьева, 17
- **Address**: Новосибирск, проспект Академика Лаврентьева, 17
- **City/Region**: Новосибирская область
- **Archetype**: university cluster
- **Expected score band**: moderate
- **Expected numeric range**: 45–70
- **Expected audience**: mixed
- **must_not_happen**: premium tourist
- **Rationale (RU)**: Кампус/наука: спрос есть, но не как у центра мегаполиса.

### 39) Москва — Сеченовский университет (район), Большая Пироговская улица, 2
- **Address**: Москва, Большая Пироговская улица, 2
- **City/Region**: Москва
- **Archetype**: hospital cluster
- **Expected score band**: strong
- **Expected numeric range**: 65–90
- **Expected audience**: corporate
- **must_not_happen**: residential-only
- **Rationale (RU)**: Медицинский кластер формирует командировочные/родственники пациентов и долгосрочные визиты.

### 40) Санкт-Петербург — Клиника (условно), Литейный проспект, 56
- **Address**: Санкт-Петербург, Литейный проспект, 56
- **City/Region**: Санкт‑Петербург
- **Archetype**: hospital cluster
- **Expected score band**: moderate
- **Expected numeric range**: 55–80
- **Expected audience**: mixed
- **must_not_happen**: near-zero
- **Rationale (RU)**: Центральные медучреждения + транспорт дают устойчивый спрос.

### 41) Зеленоградск — Курортный проспект, 1
- **Address**: Зеленоградск, Курортный проспект, 1
- **City/Region**: Калининградская область
- **Archetype**: beach resort
- **Expected score band**: moderate
- **Expected numeric range**: 45–75
- **Expected audience**: resort
- **must_not_happen**: business-only
- **Rationale (RU)**: Морской курорт, спрос «resort».

### 42) Светлогорск — улица Ленина, 8
- **Address**: Светлогорск, улица Ленина, 8
- **City/Region**: Калининградская область
- **Archetype**: resort city
- **Expected score band**: moderate
- **Expected numeric range**: 45–75
- **Expected audience**: resort
- **must_not_happen**: corporate-only
- **Rationale (RU)**: Небольшой курортный город, умеренный устойчивый спрос.

### 43) Геленджик — набережная, 1
- **Address**: Геленджик, набережная, 1
- **City/Region**: Краснодарский край
- **Archetype**: beach resort
- **Expected score band**: moderate
- **Expected numeric range**: 45–80
- **Expected audience**: resort
- **must_not_happen**: strong business
- **Rationale (RU)**: Курортная набережная: туристический/курортный спрос, сезонность.

### 44) Красная Поляна — Эсто-Садок, улица Эстонская, 37
- **Address**: Сочи, Эсто‑Садок, улица Эстонская, 37
- **City/Region**: Краснодарский край
- **Archetype**: mountain resort
- **Expected score band**: moderate
- **Expected numeric range**: 45–80
- **Expected audience**: resort
- **must_not_happen**: near-zero
- **Rationale (RU)**: Горный кластер; спрос курортный, может быть сильным в сезон, но не обязан быть premium круглый год.

### 45) Норильск — промышленная зона, улица (условно) Заводская, 1
- **Address**: Норильск, Заводская улица, 1
- **City/Region**: Красноярский край
- **Archetype**: industrial edge
- **Expected score band**: weak
- **Expected numeric range**: 10–35
- **Expected audience**: corporate
- **must_not_happen**: tourist
- **Rationale (RU)**: Промышленный край, узкий корпоративный спрос, не туристический.

### 46) Тольятти — Автозаводский район, Южное шоссе, 20
- **Address**: Тольятти, Южное шоссе, 20
- **City/Region**: Самарская область
- **Archetype**: industrial edge
- **Expected score band**: weak
- **Expected numeric range**: 15–40
- **Expected audience**: corporate
- **must_not_happen**: premium
- **Rationale (RU)**: Индустриальная периферия, спрос ограничен рабочими сценариями.

### 47) Москва — Бирюлёво Западное, Харьковская улица, 2
- **Address**: Москва, Харьковская улица, 2
- **City/Region**: Москва
- **Archetype**: low competition niche
- **Expected score band**: weak
- **Expected numeric range**: 20–45
- **Expected audience**: residential
- **must_not_happen**: premium tourist
- **Rationale (RU)**: Низкая конкуренция сама по себе не делает спрос сильным; ниша возможна, но оценка должна быть осторожной.

### 48) Москва — Китай-город, улица Маросейка, 2/15
- **Address**: Москва, улица Маросейка, 2/15
- **City/Region**: Москва
- **Archetype**: high competition saturated area
- **Expected score band**: premium
- **Expected numeric range**: 75–95
- **Expected audience**: tourist
- **must_not_happen**:
  - «Слабый спрос» при центре, даже если конкурентов много
- **Rationale (RU)**: Центр с высокой конкуренцией: спрос сильный, важно не «обнулить» его из-за competitor pressure.

### 49) Санкт-Петербург — Невский проспект, 110
- **Address**: Санкт-Петербург, Невский проспект, 110
- **City/Region**: Санкт‑Петербург
- **Archetype**: high competition saturated area
- **Expected score band**: strong
- **Expected numeric range**: 70–95
- **Expected audience**: mixed
- **must_not_happen**: weak
- **Rationale (RU)**: Насыщенный центр: конкуренция высокая, но спрос не должен падать в weak.

### 50) Суздаль — улица Ленина, 1
- **Address**: Суздаль, улица Ленина, 1
- **City/Region**: Владимирская область
- **Archetype**: village / settlement
- **Expected score band**: moderate
- **Expected numeric range**: 35–60
- **Expected audience**: tourist
- **must_not_happen**:
  - near-zero если это туристический малый город
- **Rationale (RU)**: Малый туристический город: не мегаполис, но туристический спрос присутствует.

