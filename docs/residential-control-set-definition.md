# Residential Control Set — Definition

**Version:** baseline-v1 (2026-04-19)  
**Cases:** 28  
**Purpose:** Fixed reference set for repeatable residential validation. Never changed retroactively — add new cases in a new version file.

---

## Archetype Coverage

| Archetype | Cases |
|-----------|-------|
| Strong urban core | R01, R22 |
| Quiet premium | R02, R18 |
| Family-friendly district | R05 |
| Transport-heavy but noisy | R06 |
| Tourist-heavy but weak for living | R04, R15 |
| Medical-adjacent | R07, R13 |
| Weak suburb | R08, R19 |
| Medium residential urban | R09, R24 |
| Mixed-use contested | R10, R16 |
| Premium but low-demand | R11, R21 |
| High-demand but harsh environment | R03, R17, R23, R25 |
| Edge / conflicting signals | R20, R26, R27, R28 |
| Industrial conversion | R28 |
| Resort / seasonal | R27 |
| Airport zone | R12 |
| Soviet-era block | R14 |

---

## Case Definitions

### R01 — Москва-Сити (Пресненская наб.)
| Field | Value |
|-------|-------|
| id | R01 |
| address | Пресненская наб., 6, Москва |
| city / country | Москва, Россия |
| archetype | strong urban core — business-led |
| locationScore | 82 |
| demandScore | 85 |
| seasonalityScore | 68 |
| audienceFitScore | 72 |
| evergreenIndex | 78 |
| stability01 | 0.62 |
| magnetCount | 12 |
| isFallbackMode | false |
| competitorPressure | high |
| friction | 42 — elevated |
| breakdown | nightlife=0.35 · industrial=0.12 · roads=0.65 · aviation=0.08 · stack=0.48 |
| expected commercialStrength | strong |
| expected environmentQuality | elevated |
| expected audienceFit | mixed |
| expected strategy | hybrid |
| expected opSuit | semi_auto |
| expected confidence | high |
| notes | Деловой центр с высоким спросом. Транспортная нагрузка (МКАД/ТТК) блокирует short_term несмотря на сильные магниты. Главный тест: elevated env не должен обнулять стратегию при score=82. |

---

### R02 — Остоженка / Золотая миля
| Field | Value |
|-------|-------|
| id | R02 |
| address | ул. Остоженка, 38, Москва |
| city / country | Москва, Россия |
| archetype | quiet premium |
| locationScore | 74 |
| demandScore | 69 |
| seasonalityScore | 62 |
| audienceFitScore | 58 |
| evergreenIndex | 70 |
| stability01 | 0.68 |
| magnetCount | 8 |
| isFallbackMode | false |
| competitorPressure | medium |
| friction | 14 — low |
| breakdown | nightlife=0.12 · industrial=0.08 · roads=0.20 · aviation=0.05 · stack=0.18 |
| expected commercialStrength | strong |
| expected environmentQuality | quiet |
| expected audienceFit | premium |
| expected strategy | selective_premium_short_term |
| expected opSuit | full_auto |
| expected confidence | high |
| notes | Эталонный quiet premium кейс. Все условия premium_comfort выполнены. Должен давать full_auto. Если не даёт — критическая ошибка. |

---

### R03 — Люблино, промышленная зона
| Field | Value |
|-------|-------|
| id | R03 |
| address | Люблинская ул., 72, Москва |
| city / country | Москва, Россия |
| archetype | high-demand but harsh environment — industrial |
| locationScore | 58 |
| demandScore | 75 |
| seasonalityScore | 55 |
| audienceFitScore | 45 |
| evergreenIndex | 61 |
| stability01 | 0.52 |
| magnetCount | 6 |
| isFallbackMode | false |
| competitorPressure | medium |
| friction | 68 — elevated |
| breakdown | nightlife=0.42 · industrial=0.62 · roads=0.72 · aviation=0.10 · stack=0.72 |
| expected commercialStrength | medium |
| expected environmentQuality | harsh |
| expected audienceFit | standard |
| expected strategy | cautious_manual_only |
| expected opSuit | manual |
| expected confidence | low |
| notes | Высокий спрос, но среда промышленная и шумная. cautious_manual_only — единственно правильная стратегия. Если модель даёт что-то оптимистичнее — регрессия. |

---

### R04 — СПб, исторический центр (Невский пр-т)
| Field | Value |
|-------|-------|
| id | R04 |
| address | Невский пр-т, 25, Санкт-Петербург |
| city / country | Санкт-Петербург, Россия |
| archetype | tourist-heavy — active STR market |
| locationScore | 72 |
| demandScore | 78 |
| seasonalityScore | 85 |
| audienceFitScore | 62 |
| evergreenIndex | 72 |
| stability01 | 0.44 |
| magnetCount | 9 |
| isFallbackMode | false |
| competitorPressure | high |
| friction | 38 — moderate |
| breakdown | nightlife=0.55 · industrial=0.08 · roads=0.38 · aviation=0.06 · stack=0.40 |
| expected commercialStrength | strong |
| expected environmentQuality | moderate |
| expected audienceFit | mixed |
| expected strategy | short_term |
| expected opSuit | semi_auto |
| expected confidence | high |
| notes | Туристический центр с сезонным пиком. short_term — правильно. full_auto НЕ ожидается (friction=38, не проходит порог <38). high nightlife — нормально для туристической зоны, не должен блокировать short_term. |

---

### R05 — Митино, жилой массив
| Field | Value |
|-------|-------|
| id | R05 |
| address | Митинская ул., 30, Москва |
| city / country | Москва, Россия |
| archetype | family-friendly district — quiet |
| locationScore | 55 |
| demandScore | 58 |
| seasonalityScore | 48 |
| audienceFitScore | 42 |
| evergreenIndex | 58 |
| stability01 | 0.55 |
| magnetCount | 5 |
| isFallbackMode | false |
| competitorPressure | low |
| friction | 16 — low |
| breakdown | nightlife=0.08 · industrial=0.06 · roads=0.22 · aviation=0.04 · stack=0.12 |
| expected commercialStrength | medium |
| expected environmentQuality | quiet |
| expected audienceFit | premium |
| expected strategy | hybrid |
| expected opSuit | semi_auto |
| expected confidence | medium |
| notes | premium_comfort аудитория + hybrid стратегия — design tension (score=55 не проходит locationScore≥56 для selective). Допустимо. Ключевой тест: модель не должна эскалировать до selective при score=55. |

---

### R06 — Шоссе Энтузиастов, транспортный узел
| Field | Value |
|-------|-------|
| id | R06 |
| address | ш. Энтузиастов, 56, Москва |
| city / country | Москва, Россия |
| archetype | transport-heavy but noisy |
| locationScore | 64 |
| demandScore | 68 |
| seasonalityScore | 52 |
| audienceFitScore | 40 |
| evergreenIndex | 63 |
| stability01 | 0.60 |
| magnetCount | 7 |
| isFallbackMode | false |
| competitorPressure | medium |
| friction | 52 — elevated |
| breakdown | nightlife=0.18 · industrial=0.15 · roads=0.78 · aviation=0.12 · stack=0.55 |
| expected commercialStrength | medium |
| expected environmentQuality | elevated |
| expected audienceFit | mixed |
| expected strategy | cautious_manual_only |
| expected opSuit | manual |
| expected confidence | low |
| notes | Транзитный коридор с высокой дорожной нагрузкой. score=64 < 68 при elevated → cautious. Правильно. Основной риск: если пороговое смещение score убирает cautious для этого типа — регрессия. |

---

### R07 — Щепкинский пер., медицинская зона
| Field | Value |
|-------|-------|
| id | R07 |
| address | Щепкина ул., 61, Москва |
| city / country | Москва, Россия |
| archetype | medical-adjacent — quiet, moderate demand |
| locationScore | 60 |
| demandScore | 62 |
| seasonalityScore | 44 |
| audienceFitScore | 38 |
| evergreenIndex | 58 |
| stability01 | 0.50 |
| magnetCount | 4 |
| isFallbackMode | false |
| competitorPressure | low |
| friction | 22 — low |
| breakdown | nightlife=0.10 · industrial=0.05 · roads=0.35 · aviation=0.04 · stack=0.20 |
| expected commercialStrength | medium |
| expected environmentQuality | quiet |
| expected audienceFit | premium |
| expected strategy | selective_premium_short_term |
| expected opSuit | semi_auto |
| expected confidence | medium |
| notes | Медицинский кластер + тихая среда. selective_premium правильно при medium confidence. Тест на минимальный порог selective: magnetCount=4, audienceFitScore=38 — граничные значения. |

---

### R08 — Люберцы, спальный район
| Field | Value |
|-------|-------|
| id | R08 |
| address | ул. Кирова, 24, Люберцы |
| city / country | Люберцы, Россия |
| archetype | weak suburb |
| locationScore | 28 |
| demandScore | 32 |
| seasonalityScore | 35 |
| audienceFitScore | 22 |
| evergreenIndex | 28 |
| stability01 | 0.32 |
| magnetCount | 2 |
| isFallbackMode | true |
| competitorPressure | low |
| friction | 12 — low |
| breakdown | nightlife=0.05 · industrial=0.03 · roads=0.15 · aviation=0.02 · stack=0.08 |
| expected commercialStrength | weak |
| expected environmentQuality | quiet |
| expected audienceFit | standard |
| expected strategy | mid_term |
| expected opSuit | manual |
| expected confidence | low |
| notes | Слабый пригород, fallback режим. Уверенность должна быть low. manual — единственно допустимое. Если модель даёт semi_auto при confidence=low — критическая ошибка. |

---

### R09 — Коптево, средняя жилая зона
| Field | Value |
|-------|-------|
| id | R09 |
| address | Коптевская ул., 40, Москва |
| city / country | Москва, Россия |
| archetype | medium residential urban |
| locationScore | 52 |
| demandScore | 54 |
| seasonalityScore | 50 |
| audienceFitScore | 35 |
| evergreenIndex | 50 |
| stability01 | 0.45 |
| magnetCount | 5 |
| isFallbackMode | false |
| competitorPressure | medium |
| friction | 30 — moderate |
| breakdown | nightlife=0.22 · industrial=0.18 · roads=0.42 · aviation=0.08 · stack=0.35 |
| expected commercialStrength | medium |
| expected environmentQuality | moderate |
| expected audienceFit | standard |
| expected strategy | hybrid |
| expected opSuit | semi_auto |
| expected confidence | medium |
| notes | Типичный средний городской жилой кейс. hybrid — правильно. Тест на стабильность "серединного" профиля. |

---

### R10 — Китай-город, ночная жизнь
| Field | Value |
|-------|-------|
| id | R10 |
| address | Маросейка ул., 11, Москва |
| city / country | Москва, Россия |
| archetype | mixed-use contested — nightlife heavy |
| locationScore | 70 |
| demandScore | 74 |
| seasonalityScore | 65 |
| audienceFitScore | 55 |
| evergreenIndex | 70 |
| stability01 | 0.56 |
| magnetCount | 8 |
| isFallbackMode | false |
| competitorPressure | high |
| friction | 48 — elevated |
| breakdown | nightlife=0.68 · industrial=0.12 · roads=0.35 · aviation=0.06 · stack=0.45 |
| expected commercialStrength | strong |
| expected environmentQuality | elevated |
| expected audienceFit | mixed |
| expected strategy | hybrid |
| expected opSuit | semi_auto |
| expected confidence | medium |
| notes | Высокий nightlife не должен один блокировать short_term (нет industrial stack). elevated env → hybrid вместо short_term — правильно. Pass-3: уверенность medium (elevated+hybrid без prime-core exception). Тест: nightlife-only не должен давать cautious если нет second burden. |

---

### R11 — Раменки, премиум без спроса
| Field | Value |
|-------|-------|
| id | R11 |
| address | Мичуринский пр-т, 6, Москва |
| city / country | Москва, Россия |
| archetype | premium but low-demand |
| locationScore | 65 |
| demandScore | 42 |
| seasonalityScore | 38 |
| audienceFitScore | 48 |
| evergreenIndex | 60 |
| stability01 | 0.62 |
| magnetCount | 4 |
| isFallbackMode | false |
| competitorPressure | low |
| friction | 10 — low |
| breakdown | nightlife=0.06 · industrial=0.04 · roads=0.18 · aviation=0.03 · stack=0.10 |
| expected commercialStrength | medium |
| expected environmentQuality | quiet |
| expected audienceFit | premium |
| expected strategy | selective_premium_short_term |
| expected opSuit | semi_auto |
| expected confidence | medium |
| notes | Тихая зона с хорошей средой, но слабый спрос. selective_premium правильно (demand не нужен для selective, нужны env + score). medium confidence — верно из-за слабых магнитов. |

---

### R12 — Внуково, авиационная зона
| Field | Value |
|-------|-------|
| id | R12 |
| address | ул. Центральная, 12, Внуково |
| city / country | Москва, Россия |
| archetype | airport zone — aviation-heavy |
| locationScore | 48 |
| demandScore | 50 |
| seasonalityScore | 55 |
| audienceFitScore | 35 |
| evergreenIndex | 48 |
| stability01 | 0.42 |
| magnetCount | 3 |
| isFallbackMode | false |
| competitorPressure | medium |
| friction | 62 — elevated |
| breakdown | nightlife=0.08 · industrial=0.12 · roads=0.45 · aviation=0.88 · stack=0.55 |
| expected commercialStrength | weak |
| expected environmentQuality | harsh |
| expected audienceFit | standard |
| expected strategy | cautious_manual_only |
| expected opSuit | manual |
| expected confidence | low |
| notes | Аэропортная зона с высокой авиационной нагрузкой. score=48 < 68 при elevated → cautious. Ключевой тест: aviation нагрузка должна отражаться в friction, но не в самом residential engine напрямую. |

---

### R13 — Боткинская больница, тихая зона
| Field | Value |
|-------|-------|
| id | R13 |
| address | 2-й Боткинский пр., 5, Москва |
| city / country | Москва, Россия |
| archetype | medical-adjacent — strong cluster, quiet |
| locationScore | 68 |
| demandScore | 65 |
| seasonalityScore | 42 |
| audienceFitScore | 52 |
| evergreenIndex | 65 |
| stability01 | 0.58 |
| magnetCount | 7 |
| isFallbackMode | false |
| competitorPressure | low |
| friction | 18 — low |
| breakdown | nightlife=0.08 · industrial=0.06 · roads=0.28 · aviation=0.03 · stack=0.16 |
| expected commercialStrength | strong |
| expected environmentQuality | quiet |
| expected audienceFit | premium |
| expected strategy | selective_premium_short_term |
| expected opSuit | full_auto |
| expected confidence | high |
| notes | Сильный медицинский кластер + тихая среда = эталон selective premium с high confidence. full_auto ожидается. Если confidence=medium — подозрение. |

---

### R14 — Тушино, советский жилой массив
| Field | Value |
|-------|-------|
| id | R14 |
| address | Сходненская ул., 14, Москва |
| city / country | Москва, Россия |
| archetype | Soviet-era block — transit ok |
| locationScore | 48 |
| demandScore | 56 |
| seasonalityScore | 48 |
| audienceFitScore | 32 |
| evergreenIndex | 48 |
| stability01 | 0.50 |
| magnetCount | 4 |
| isFallbackMode | false |
| competitorPressure | medium |
| friction | 36 — moderate |
| breakdown | nightlife=0.18 · industrial=0.25 · roads=0.52 · aviation=0.05 · stack=0.42 |
| expected commercialStrength | weak |
| expected environmentQuality | moderate |
| expected audienceFit | standard |
| expected strategy | hybrid |
| expected opSuit | semi_auto |
| expected confidence | medium |
| notes | Типичный спальный панельный район с достаточным транзитом. hybrid — правильно. Тест на то, что moderate env не вызывает cautious при нормальных бурденах. |

---

### R15 — СПб, зона ночного города (туристический)
| Field | Value |
|-------|-------|
| id | R15 |
| address | Думская ул., 3, Санкт-Петербург |
| city / country | Санкт-Петербург, Россия |
| archetype | tourist-heavy but harsh for living — nightlife + elevated |
| locationScore | 75 |
| demandScore | 80 |
| seasonalityScore | 88 |
| audienceFitScore | 65 |
| evergreenIndex | 75 |
| stability01 | 0.45 |
| magnetCount | 10 |
| isFallbackMode | false |
| competitorPressure | high |
| friction | 45 — elevated |
| breakdown | nightlife=0.72 · industrial=0.10 · roads=0.38 · aviation=0.05 · stack=0.48 |
| expected commercialStrength | strong |
| expected environmentQuality | elevated |
| expected audienceFit | mixed |
| expected strategy | hybrid |
| expected opSuit | semi_auto |
| expected confidence | medium |
| notes | Высокий туристический поток и сезонность, но elevated env и nightlife. elevated env блокирует short_term → hybrid. Pass-3: уверенность medium. Ключевой тест: nightlife=0.72 + industrial=0.10 должны НЕ давать cautious (нет double-burden). |

---

### R16 — Арбат, коммерческая граница
| Field | Value |
|-------|-------|
| id | R16 |
| address | Арбат ул., 36, Москва |
| city / country | Москва, Россия |
| archetype | mixed-use contested — commercial edge |
| locationScore | 62 |
| demandScore | 65 |
| seasonalityScore | 55 |
| audienceFitScore | 48 |
| evergreenIndex | 60 |
| stability01 | 0.52 |
| magnetCount | 6 |
| isFallbackMode | false |
| competitorPressure | medium |
| friction | 28 — moderate |
| breakdown | nightlife=0.30 · industrial=0.22 · roads=0.55 · aviation=0.06 · stack=0.38 |
| expected commercialStrength | medium |
| expected environmentQuality | moderate |
| expected audienceFit | mixed |
| expected strategy | hybrid |
| expected opSuit | semi_auto |
| expected confidence | medium |
| notes | Граница жилого и коммерческого. mixed_use_adjacent правильно (score=62 ≥ 62, friction=28 ≥ 26). hybrid — правильно. Тест на точность порога mixed_use_adjacent. |

---

### R17 — Преображенская, промконверсия (высокая гравитация)
| Field | Value |
|-------|-------|
| id | R17 |
| address | Преображенская пл., 8, Москва |
| city / country | Москва, Россия |
| archetype | industrial conversion — high gravity, conflicting signals |
| locationScore | 70 |
| demandScore | 73 |
| seasonalityScore | 62 |
| audienceFitScore | 52 |
| evergreenIndex | 70 |
| stability01 | 0.58 |
| magnetCount | 9 |
| isFallbackMode | false |
| competitorPressure | medium |
| friction | 58 — elevated |
| breakdown | nightlife=0.22 · industrial=0.72 · roads=0.62 · aviation=0.08 · stack=0.68 |
| expected commercialStrength | strong |
| expected environmentQuality | elevated |
| expected audienceFit | mixed |
| expected strategy | hybrid |
| expected opSuit | semi_auto |
| expected confidence | medium |
| notes | Высокие магниты (бывший завод, ставший деловым центром) + тяжёлая среда. Конфликт. elevated env → hybrid. industrial=0.72 один без nightlife не даёт cautious. Pass-3: промка + стек → потолок уверенности medium. Тест на industrial-only burden. |

---

### R18 — Хамовники, тихий центр (STR-friendly)
| Field | Value |
|-------|-------|
| id | R18 |
| address | Зубовский бул., 22, Москва |
| city / country | Москва, Россия |
| archetype | quiet premium — strong demand |
| locationScore | 78 |
| demandScore | 80 |
| seasonalityScore | 72 |
| audienceFitScore | 68 |
| evergreenIndex | 78 |
| stability01 | 0.72 |
| magnetCount | 11 |
| isFallbackMode | false |
| competitorPressure | medium |
| friction | 20 — low |
| breakdown | nightlife=0.18 · industrial=0.08 · roads=0.30 · aviation=0.05 · stack=0.22 |
| expected commercialStrength | strong |
| expected environmentQuality | quiet |
| expected audienceFit | premium |
| expected strategy | selective_premium_short_term |
| expected opSuit | full_auto |
| expected confidence | high |
| notes | Эталонный strong quiet premium. selective_premium берёт приоритет над short_term (premium_comfort audienceType). full_auto + high confidence ожидается. Если что-то хуже — регрессия. |

---

### R19 — Краснодар, удалённый район (fallback)
| Field | Value |
|-------|-------|
| id | R19 |
| address | ул. Российская, 188, Краснодар |
| city / country | Краснодар, Россия |
| archetype | distant suburb — fallback tourist mode |
| locationScore | 35 |
| demandScore | 38 |
| seasonalityScore | 60 |
| audienceFitScore | 28 |
| evergreenIndex | 35 |
| stability01 | 0.30 |
| magnetCount | 1 |
| isFallbackMode | true |
| competitorPressure | low |
| friction | 10 — low |
| breakdown | nightlife=0.05 · industrial=0.03 · roads=0.12 · aviation=0.02 · stack=0.06 |
| expected commercialStrength | none |
| expected environmentQuality | quiet |
| expected audienceFit | standard |
| expected strategy | mid_term |
| expected opSuit | manual |
| expected confidence | low |
| notes | Очень слабая локация, fallback режим. confidence=low → manual — обязательно. Тест на защиту от overconfident output при fallback + 1 магните. |

---

### R20 — Бирюлёво (пограничная стабильность = 0.47)
| Field | Value |
|-------|-------|
| id | R20 |
| address | Бирюлёвская ул., 52, Москва |
| city / country | Москва, Россия |
| archetype | edge case — stability just below premium_comfort threshold |
| locationScore | 58 |
| demandScore | 60 |
| seasonalityScore | 52 |
| audienceFitScore | 42 |
| evergreenIndex | 58 |
| stability01 | 0.47 |
| magnetCount | 5 |
| isFallbackMode | false |
| competitorPressure | low |
| friction | 16 — low |
| breakdown | nightlife=0.20 · industrial=0.12 · roads=0.32 · aviation=0.08 · stack=0.22 |
| expected commercialStrength | medium |
| expected environmentQuality | quiet |
| expected audienceFit | standard |
| expected strategy | hybrid |
| expected opSuit | semi_auto |
| expected confidence | medium |
| notes | stability=0.47 — на 0.01 ниже порога 0.48. audienceType должен быть standard_residential (не premium_comfort). Тест на cliff-effect: малое изменение stability не должно вызывать dramatic strategy shift. Сейчас это именно так — важный регрессионный триггер. |

---

### R21 — Покровка, высокая конкуренция, слабый спрос
| Field | Value |
|-------|-------|
| id | R21 |
| address | Покровка ул., 18, Москва |
| city / country | Москва, Россия |
| archetype | premium area — high competition, weak demand |
| locationScore | 55 |
| demandScore | 42 |
| seasonalityScore | 45 |
| audienceFitScore | 35 |
| evergreenIndex | 55 |
| stability01 | 0.52 |
| magnetCount | 3 |
| isFallbackMode | false |
| competitorPressure | high |
| friction | 24 — low |
| breakdown | nightlife=0.15 · industrial=0.10 · roads=0.28 · aviation=0.05 · stack=0.20 |
| expected commercialStrength | medium |
| expected environmentQuality | quiet |
| expected audienceFit | premium |
| expected strategy | mid_term |
| expected opSuit | semi_auto |
| expected confidence | medium |
| notes | premium_comfort аудитория + mid_term стратегия — design tension. Правильно по логике движка (demand слабый), но неинтуитивно. Тест на то, что локация с тихой средой но слабым спросом корректно получает mid_term без эскалации. |

---

### R22 — Тверская, плотный деловой кластер
| Field | Value |
|-------|-------|
| id | R22 |
| address | Тверская ул., 14, Москва |
| city / country | Москва, Россия |
| archetype | strong urban core — dense business cluster |
| locationScore | 85 |
| demandScore | 88 |
| seasonalityScore | 75 |
| audienceFitScore | 78 |
| evergreenIndex | 85 |
| stability01 | 0.68 |
| magnetCount | 15 |
| isFallbackMode | false |
| competitorPressure | medium |
| friction | 35 — moderate |
| breakdown | nightlife=0.28 · industrial=0.15 · roads=0.45 · aviation=0.08 · stack=0.40 |
| expected commercialStrength | strong |
| expected environmentQuality | moderate |
| expected audienceFit | mixed |
| expected strategy | short_term |
| expected opSuit | full_auto |
| expected confidence | high |
| notes | Эталонный кейс для short_term + full_auto. moderate env не блокирует short_term. friction=35 < 38 → full_auto. Если модель не даёт short_term здесь — критическая регрессия. |

---

### R23 — Таганская, ночная + дорожная нагрузка
| Field | Value |
|-------|-------|
| id | R23 |
| address | Таганская пл., 3, Москва |
| city / country | Москва, Россия |
| archetype | harsh urban — nightlife + major road stack |
| locationScore | 72 |
| demandScore | 76 |
| seasonalityScore | 68 |
| audienceFitScore | 60 |
| evergreenIndex | 72 |
| stability01 | 0.60 |
| magnetCount | 10 |
| isFallbackMode | false |
| competitorPressure | medium |
| friction | 62 — high |
| breakdown | nightlife=0.55 · industrial=0.35 · roads=0.72 · aviation=0.15 · stack=0.75 |
| expected commercialStrength | strong |
| expected environmentQuality | harsh |
| expected audienceFit | mixed |
| expected strategy | cautious_manual_only |
| expected opSuit | manual |
| expected confidence | low |
| notes | Double burden: nightlife=0.55 + majorRoad=0.72 → cautious_manual_only. Несмотря на score=72. Тест на double-burden logic: обязательный must-pass. |

---

### R24 — Щёлково, хороший транзит, средний уровень
| Field | Value |
|-------|-------|
| id | R24 |
| address | Щёлковское ш., 100, Москва |
| city / country | Москва, Россия |
| archetype | good transit — average residential |
| locationScore | 58 |
| demandScore | 58 |
| seasonalityScore | 52 |
| audienceFitScore | 40 |
| evergreenIndex | 58 |
| stability01 | 0.50 |
| magnetCount | 5 |
| isFallbackMode | false |
| competitorPressure | low |
| friction | 28 — moderate |
| breakdown | nightlife=0.20 · industrial=0.18 · roads=0.38 · aviation=0.05 · stack=0.32 |
| expected commercialStrength | medium |
| expected environmentQuality | moderate |
| expected audienceFit | standard |
| expected strategy | hybrid |
| expected opSuit | semi_auto |
| expected confidence | medium |
| notes | Средний транзитный район. hybrid — правильно. Тест на стабильность стандартного residential профиля без edge-case усложнений. |

---

### R25 — Охотный ряд / центр Москвы
| Field | Value |
|-------|-------|
| id | R25 |
| address | Охотный ряд, 2, Москва |
| city / country | Москва, Россия |
| archetype | high-demand harsh env — best-in-class score, elevated friction |
| locationScore | 88 |
| demandScore | 90 |
| seasonalityScore | 82 |
| audienceFitScore | 82 |
| evergreenIndex | 88 |
| stability01 | 0.70 |
| magnetCount | 18 |
| isFallbackMode | false |
| competitorPressure | high |
| friction | 40 — elevated |
| breakdown | nightlife=0.45 · industrial=0.08 · roads=0.58 · aviation=0.05 · stack=0.48 |
| expected commercialStrength | strong |
| expected environmentQuality | elevated |
| expected audienceFit | mixed |
| expected strategy | short_term |
| expected opSuit | semi_auto |
| expected confidence | high |
| notes | KNOWN GAP: текущая модель выдаёт hybrid (elevated env блокирует short_term). Идеальный ответ — short_term: score=88, demand=90, season=82 не должны превращаться в hybrid из-за городской среды. Это самый важный regression risk: правило elevated→no short_term слишком широкое. |

---

### R26 — Кунцево (пограничный selective, stability=0.50)
| Field | Value |
|-------|-------|
| id | R26 |
| address | Можайское ш., 2, Москва |
| city / country | Москва, Россия |
| archetype | edge case — selective threshold at exact boundary |
| locationScore | 58 |
| demandScore | 58 |
| seasonalityScore | 52 |
| audienceFitScore | 38 |
| evergreenIndex | 58 |
| stability01 | 0.50 |
| magnetCount | 5 |
| isFallbackMode | false |
| competitorPressure | low |
| friction | 25 — low |
| breakdown | nightlife=0.20 · industrial=0.12 · roads=0.32 · aviation=0.06 · stack=0.24 |
| expected commercialStrength | medium |
| expected environmentQuality | quiet |
| expected audienceFit | premium |
| expected strategy | selective_premium_short_term |
| expected opSuit | semi_auto |
| expected confidence | medium |
| notes | Пограничный кейс selective_premium_short_term: stability=0.50 ровно на пороге ≥0.50. Должен давать selective. Тест на inclusive inequality. |

---

### R27 — Адлер / Сочи, курорт сезонный
| Field | Value |
|-------|-------|
| id | R27 |
| address | Ленина ул., 120, Адлер, Сочи |
| city / country | Сочи, Россия |
| archetype | resort / seasonal — high seasonality, low stability |
| locationScore | 65 |
| demandScore | 70 |
| seasonalityScore | 92 |
| audienceFitScore | 65 |
| evergreenIndex | 65 |
| stability01 | 0.38 |
| magnetCount | 6 |
| isFallbackMode | false |
| competitorPressure | medium |
| friction | 18 — low |
| breakdown | nightlife=0.25 · industrial=0.08 · roads=0.20 · aviation=0.06 · stack=0.20 |
| expected commercialStrength | strong |
| expected environmentQuality | quiet |
| expected audienceFit | standard |
| expected strategy | short_term |
| expected opSuit | semi_auto |
| expected confidence | high |
| notes | KNOWN GAP: текущая модель выдаёт hybrid (demand=70 < 72 порог short_term). Но seasonality=92 однозначно говорит о курортной STR локации. Модель игнорирует seasonality при низком stability. Это design gap для следующего pass. |

---

### R28 — Лефортово, промышленная конверсия (mixed)
| Field | Value |
|-------|-------|
| id | R28 |
| address | Лефортовская наб., 14, Москва |
| city / country | Москва, Россия |
| archetype | industrial conversion — mixed-use contested, elevated |
| locationScore | 62 |
| demandScore | 64 |
| seasonalityScore | 58 |
| audienceFitScore | 45 |
| evergreenIndex | 62 |
| stability01 | 0.55 |
| magnetCount | 6 |
| isFallbackMode | false |
| competitorPressure | medium |
| friction | 44 — elevated |
| breakdown | nightlife=0.22 · industrial=0.48 · roads=0.55 · aviation=0.06 · stack=0.52 |
| expected commercialStrength | medium |
| expected environmentQuality | elevated |
| expected audienceFit | mixed |
| expected strategy | cautious_manual_only |
| expected opSuit | manual |
| expected confidence | low |
| notes | score=62 < 68 при elevated → cautious. Бывший промышленный квартал в стадии реновации. Тест на то, что borderline mixed_use_adjacent + elevated корректно попадает в cautious. |

---

## Summary Statistics

- **Total cases:** 28  
- **Must-pass cases (zero ambiguity):** R02, R08, R13, R18, R22, R23  
- **Known gap cases (expected ≠ current model):** R25, R27  
- **Edge / threshold cases:** R05, R20, R21, R26  
- **Ambiguity-allowed cases (multiple valid answers):** R04 (semi_auto vs full_auto borderline), R07 (medium vs high confidence borderline)
