# Location Intelligence — Standalone Product MVP Plan

_Статус: план первой публичной версии. Дата: 2026-04-18._

---

## 1. Что уже готово в репозитории (не нужно строить с нуля)

### Инфраструктура движка

| Компонент | Файл | Готовность |
|---|---|---|
| Gravity scoring | `src/lib/location/gravity-scoring.ts` | ✅ production |
| Types (все) | `src/lib/location/types.ts` | ✅ production |
| Magnet config | `src/lib/location/config.ts` | ✅ production |
| OSM fetch / classify | `src/lib/location/overpass.ts` | ✅ production |
| Foot traffic summary | `src/lib/location/foot-traffic.ts` | ✅ production |
| Audience analysis | `src/lib/location/audience-scoring.ts` | ✅ production |
| Location score output | `src/lib/location/location-score.ts` | ✅ production |
| Neighborhood environment | `src/lib/location/neighborhood-environment.ts` | ✅ production |
| Commercial env modifier | `src/lib/location/neighborhood-environment-commercial-modifier.ts` | ✅ (new, untracked) |
| Heatmap | `src/lib/location/heatmap.ts` | ✅ production |
| Standalone report builder | `src/lib/location/standalone-report.ts` | ✅ production |
| Report paywall wrapper | `src/lib/location/location-report-paywall.ts` | ✅ production |

### Frontend страницы (уже существуют)

| URL | Файл | Статус |
|---|---|---|
| `/features/location-analysis` | `src/app/features/location-analysis/page.tsx` | ✅ Существует (EN) |
| `/ru/location-analysis` | `src/app/ru/location-analysis/page.tsx` | ✅ Существует (RU) |
| `/ru/location-report/[reportId]` | `src/app/ru/location-report/[reportId]/page.tsx` | ✅ Permalink-отчёт |
| `/ru/location-report` | `src/app/ru/location-report/page.tsx` | ✅ Редирект (пустой state) |

**Вывод:** standalone продукт уже частично жив. Нет отдельного брендинга, нет residential/commercial split, нет commercial-специфичного UX.

---

## 2. Что можно вывести на фронт уже сейчас (Phase 0 — 1–2 дня)

### 2.1 Брендинг split на существующих страницах

Можно немедленно:
- Добавить на `/ru/location-analysis` и `/features/location-analysis` выбор режима: **«Жилая недвижимость» / «Коммерческая локация»**
- Показать разные заголовки, описания и CTA в зависимости от выбора
- Пока под капотом — тот же движок, но разные тексты и акценты

Это не требует изменений в backend. Только фронт.

### 2.2 Переименование заголовков

Текущий H1: «Доходность начинается с локации» (RU) / «Location Analysis» (EN)

Новый H1 для residential: **«Rental Intelligence — оценка локации для аренды»**  
Новый H1 для commercial: **«Пространственный анализ локации для бизнеса»**

### 2.3 Отдельные страницы под каждую ветку

Создать (минимальная работа):
- `/ru/location-analysis/residential` — residential path
- `/ru/location-analysis/commercial` — commercial path
- `/features/location-analysis/residential` — EN residential
- `/features/location-analysis/commercial` — EN commercial

Либо сделать через query param: `/ru/location-analysis?mode=commercial`

---

## 3. Residential ветка — что можно сделать быстро (Phase 1 — 3–5 дней)

Движок уже полностью готов. Нужен только переупакованный UI.

### Задачи

| Задача | Сложность | Что нужно |
|---|---|---|
| Отдельная residential страница с правильным заголовком | Низкая | Копипаст + новые тексты |
| Residential-специфичный вывод: стратегия + доход | Низкая | Уже в `LocationScoreOutput` |
| Audience fit блок (BUSINESS/TOURIST/FAMILY) | Низкая | Уже в `AudienceAnalysis` |
| Neighborhood environment блок | Низкая | Уже в `NeighborhoodEnvironmentLayer` |
| Income estimate (₽/мес по 3 стратегиям) | Низкая | Уже в `estimated_monthly_income` |
| Permalink отчёт для residential | Средняя | `/ru/location-report/[reportId]` уже работает |
| SEO-метаданные под residential | Низкая | Новые title/description |

### Что residential MVP показывает уже сейчас

Из существующего `LocationAnalysis` + `LocationScoreOutput`:
- ✅ Location Score 0–100
- ✅ Demand / Supply / Magnet / Audience fit / Accessibility breakdown
- ✅ Audience type (BUSINESS / TOURIST / FAMILY)
- ✅ Primary audience magnets с дистанциями
- ✅ Recommended strategy (short_term / hybrid / mid_term)
- ✅ Monthly income estimate (₽) по стратегиям
- ✅ Top positive / negative factors
- ✅ Neighborhood environment: concern level + текст
- ✅ Competitor count + pressure level
- ✅ Heatmap
- ✅ Conclusion (текстовый вывод)

**Residential продукт готов к продаже сейчас.** Нужен только правильный фрейм и отдельная страница.

---

## 4. Commercial / Retail ветка — что можно сделать быстро (Phase 1 — 5–8 дней)

### 4.1 Что уже есть в движке и работает как commercial proxy

| Сигнал | Источник | Использование в commercial |
|---|---|---|
| Foot traffic summary | `FootTrafficSummary` | Transit vs retail-relevant vs destination split |
| Magnet типология | `MAGNET_CATEGORIES` + `MagnetItem` | Классификация потока по типу (business/tourist/food/retail) |
| Competitor pressure | `CompetitorItem[]` + gravityExplanation | Насыщение рынка в радиусе |
| Heatmap points | `HeatmapPoint[]` | Gravity-based пространственная визуализация |
| Audience analysis | `AudienceAnalysis` | Тип доминирующей аудитории |
| Neighborhood environment | `NeighborhoodEnvironmentLayer` | Физические барьеры, дороги, промзоны |

### 4.2 Что нужно добавить для commercial MVP

| Задача | Сложность | Детали |
|---|---|---|
| Business format selector | Низкая | Dropdown или radio: retail / food / service / convenience |
| Format fit scoring | Средняя | Derive от magnet typology + flow split + competitor pressure |
| Commercial report output | Средняя | Новый `buildCommercialReport()` по аналогии с `buildLocationStandaloneReport()` |
| Commercial-специфичный UI | Средняя | Другие блоки, другие заголовки, убрать income/strategy |
| Intensity rings UI | Средняя | 50/100/250/500 м кольца поверх heatmap |
| Corridor visualization | Высокая | Направления движения — отложить в Phase 2 |

### 4.3 Format fit scoring — алгоритм MVP

```
retail_fit   = high if: shopping_major + food magnets nearby + low competitor saturation
food_fit     = high if: food magnets cluster + business/tourist flow + daytime signal
service_fit  = high if: office/business magnets + local residential + steady flow
convenience_fit = high if: residential + education_local + shopping_local nearby
destination_fit = high if: attraction/entertainment/convention + city-scale magnets
showroom_fit = high if: business magnets + transport access + low pedestrian saturation
```

Каждый fit = 'strong' | 'moderate' | 'weak' + одна строка объяснения.

---

## 5. Что пока будет MVP/proxy (честно, не идеальная версия)

| Компонент | MVP реализация | Что это не даёт |
|---|---|---|
| Поток | Proxy через магниты + footTrafficSummary | Реальный подсчёт людей |
| Дневной/вечерний профиль | Inference от типа магнитов (office→день, entertainment→вечер) | Реальные временны́е данные |
| Коридоры движения | Не в Phase 1 | Векторные коридоры потока |
| Micro-catchment | Радиус-кольца (50/100/250/500 м) | Реальный изохронный полигон |
| Competitor overlap | Категория + радиус | Точное перекрытие аудитории |
| Heatmap | Gravity-based intensity | Геолокационная тепловая карта |

Всё вышеперечисленное честно коммуницируется пользователю: «Анализ на основе пространственных данных OSM + AI-интерпретация» — не «точный счётчик посетителей».

---

## 6. Что можно продавать как standalone продукт уже в ближайшей версии

### Residential — готово сейчас

**Что продаём:** Rental Location Intelligence Report  
**Цена:** разовый отчёт (₽499–999) или включён в подписку  
**Что получает покупатель:**
- Location Score + breakdown
- Recommended strategy (short/hybrid/mid)
- Income estimate по стратегиям
- Audience type + primary magnets
- Competitor pressure
- Neighborhood environment
- Heatmap
- Permalink на отчёт

**Статус:** технически готово. Нужен только продающий фрейм и CTA.

---

### Commercial — Phase 1 (через 5–8 дней)

**Что продаём:** Пространственный анализ локации для бизнеса  
**Цена:** разовый отчёт (₽990–2490) — выше residential, меньше аудитории но выше ценность  
**Что получает покупатель:**
- Формат бизнеса → вывод «подходит / спорно / не подходит»
- Format fit по 6 категориям
- Структура потока (transit / retail / destination)
- Магниты в радиусах 100/250/500 м
- Competitor pressure для выбранного формата
- Heatmap с intensity rings
- Neighborhood barriers (дороги, промзоны)
- Short conclusion

---

## 7. Что требует Phase 2 (не MVP)

| Компонент | Сложность | Почему не сейчас |
|---|---|---|
| Реальные corridor vectors | Высокая | Требует routing data (OSM roads graph) |
| Изохронный micro-catchment | Высокая | Требует routing API |
| Дневной/вечерний поток split по часам | Очень высокая | Требует телеком-геолокацию или партнёрские данные |
| Retail competitor overlap scoring | Высокая | Требует классификации конкурентов по форматам |
| Multi-address сравнение | Средняя | Хорошо для enterprise, не нужно в MVP |
| PDF export | Средняя | Нужно для продажи брокерам и ритейлерам |
| API доступ | Средняя | B2B / developer segment |
| EN commercial page | Низкая | После RU validaton |

---

## 8. Дорожная карта по приоритетам

```
Phase 0 (1–2 дня):
  ✦ Добавить residential/commercial split на существующие страницы
  ✦ Обновить заголовки, метаданные, CTA

Phase 1 Residential (3–5 дней):
  ✦ Отдельная residential страница с правильным продуктовым фреймом
  ✦ Перестроить UI карточки отчёта под residential логику
  ✦ Запустить CTA с оплатой

Phase 1 Commercial (5–8 дней от start):
  ✦ Business format selector (6 типов)
  ✦ Format fit scoring (алгоритм из п.4.3)
  ✦ Commercial report output structure
  ✦ Commercial UI (без corridor visualization)
  ✦ Intensity rings на heatmap

Phase 2 (следующий спринт):
  ✦ PDF export для commercial отчётов
  ✦ EN commercial page
  ✦ Corridor visualization (если есть данные)
  ✦ Multi-address comparison
```

---

## 9. Entry point на главной странице — что выводить сейчас

**Минимальный вариант (Phase 0):**

На `/ru` главной — добавить блок «Location Intelligence» с двумя карточками-путями:

```html
<section>
  <h2>Оцените локацию — до принятия решения</h2>
  <div class="cards">
    <Card
      title="Жилая недвижимость"
      desc="Доходность, стратегия, целевая аудитория, income estimate"
      cta="Оценить объект →"
      href="/ru/location-analysis?mode=residential"
    />
    <Card
      title="Коммерческая / Retail"
      desc="Пространственный анализ, структура потока, пригодность под формат"
      cta="Анализ локации →"
      href="/ru/location-analysis?mode=commercial"
    />
  </div>
</section>
```

Не прятать за аккордеон. Не смешивать в один блок. Два пути — два продукта.

---

_Документ для внутреннего использования. Связан с `location-standalone-product-spec.md`._
