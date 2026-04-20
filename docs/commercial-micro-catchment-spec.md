# Commercial Micro-Catchment Layer — Specification
**Дата:** 2026-04-19  
**Версия:** v1-spec  
**Цель:** Спроектировать micro-catchment layer для commercial режима — пространственную структуру вокруг точки, которая объясняет не только «что рядом», но и «откуда приходит поток и где граница охвата»

---

## 1. Зачем micro-catchment

Текущий движок анализирует точку как центр абстрактного радиуса:  
— ищем все magnets в радиусе 450–2000 м  
— суммируем attraction × decay  
— выдаём один evergreenIndex

Это не объясняет:
- **Откуда именно приходит поток** (с севера от метро? с юга от жилья?)  
- **Какова реальная зона захвата точки** (50 м? 500 м?)  
- **Где барьеры** (широкая дорога, река, стена забора)  
- **Каков frontage** (угловое место? узкий переулок?)  
- **Каков локальный контекст вокруг точки** (пустой стрит-флор? плотный retail-corridor?)

Для commercial решения это критично: инвестор не покупает «район», он покупает **конкретную позицию**.

---

## 2. Четыре кольца micro-catchment

### Ring 1: Immediate capture — 50 м
**Что это:**  
Буквальная зона «в дверях» — что пешеход видит, подходя к точке.  
Frontage-зона: витрины, вход, видимость с тротуара.

**Что считается (OSM-only):**
- Количество retail/café узлов в 50 м (density indicator)
- Наличие остановки транспорта (bus/tram stop ≤ 50 м)
- Наличие пешеходного перехода (highway=crossing ≤ 50 м)
- Тип дороги прямо у точки (pedestrian / footway / residential / primary)

**Интерпретация:**
- ≥3 retail nodes + pedestrian street → **Плотный ритейл-фронтаж**
- ≥1 transit stop + primary road → **Транзитный узел, высокая видимость**
- 0–1 retail nodes + residential road → **Тихий жилой блок**

**Что это НЕ:**  
Реальный пешеходный трафик у входа — это нельзя считать без mobility data.

---

### Ring 2: Walk-in zone — 100 м  
**Что это:**  
«Мой блок» — люди в этой зоне с высокой вероятностью замечают точку и могут зайти случайно.

**Что считается (OSM-only):**
- Наличие других destination-magnets (café, shop, service) — плотность
- Наличие транзитной инфраструктуры (bus stop, metro entrance ≤ 100 м)
- Тип дорожной сети (пешеходная зона? велосипедные дорожки?)
- Наличие barriers: стена, забор, вода (waterway/barrier tags)

**Интерпретация:**
- Dense retail + metro entrance → **Высокий случайный захват**
- Industrial / blank wall → **Frontage blocked**

---

### Ring 3: Primary catchment — 250 м  
**Что это:**  
Зона, откуда реалистично приходит большинство walk-in клиентов. ~3–4 минуты пешком.

**Что считается (OSM-only):**
- Магниты по категориям с их attraction scores
- Residential density proxy (число жилых зданий OSM)
- Office/business proxy (число office/commercial OSM nodes)
- Существующие конкуренты
- Основные транспортные артерии (primary/secondary roads, их количество)

**Что является proxy, а не real:**  
Мы не знаем реальный пешеходный маршрут — мы знаем прямое расстояние.  
Барьеры (река, автострада) могут увеличивать реальное время вдвое.

---

### Ring 4: Extended catchment — 500 м  
**Что это:**  
Зона destination-потока — люди, которые едут/идут специально, не случайно.  
Для форматов retail, showroom, destination: критически важно.

**Что считается (OSM-only):**
- Все magnets по текущей логике (радиусы 450–1400 м покрывают эту зону)
- Транспортные узлы
- Крупные anchors (metro, railway, hospital, university)
- Конкурентная среда (конкуренты в 500 м)

---

## 3. Corridor Logic

### Концепция corridor
Точка расположена на **оси движения** — улице или коридоре, по которому идёт основной поток.  
Если точка на главной улице = высокий corridor score.  
Если точка в переулке/тупике = низкий corridor score.

### Что можно считать из OSM

**Тип улицы (highway tag):**
```
pedestrian / living_street  → максимальный corridor score
secondary / tertiary        → средний
primary / trunk             → высокий transiting score, низкий stopping score
service / track             → минимальный
```

**Street-edge importance:**  
Угловое расположение (две улицы) > серединное (одна улица) > переулок.  
Можно приблизить: считаем количество highway-элементов в 30 м от точки.

**Crossing importance:**  
Наличие highway=crossing или traffic_signals ≤ 30 м = пешеходный hub → +corridor score

### Ограничения corridor logic
- Мы не знаем направление движения потока вдоль улицы
- Мы не знаем, идут ли люди «мимо точки» или «к точке»
- OSM не даёт данные о vehicle/pedestrian count
- Это proxy по типу дороги, а не реальный corridor analysis

### Что corridor logic даёт в отчёте
Не «сколько людей проходит мимо», а:
- **Тип позиции**: high-street / secondary-street / backstreet / transit-adjacent
- **Видимость**: corner / mid-block / recessed
- **Инфраструктурный контекст**: pedestrian zone / mixed traffic / auto-dominant

---

## 4. Spatial Position Labels (что выдаётся в отчёте)

Вместо абстрактных колец — человекочитаемые labels:

```typescript
type SpatialPositionLabel =
  | 'high_street_corner'         // Угловое место на главной торговой улице
  | 'high_street_mid'            // Средина главной торговой улицы
  | 'transit_adjacent'           // Рядом с транспортным узлом (≤ 100 м)
  | 'pedestrian_zone'            // Пешеходная зона
  | 'secondary_street'           // Второстепенная улица
  | 'backstreet'                 // Переулок или тупик
  | 'auto_corridor'              // Вдоль шоссе/магистрали
  | 'mixed_context'              // Смешанный контекст
  | 'isolated'                   // Изолированное расположение
```

---

## 5. Barrier Detection (пространственные барьеры)

### Барьеры из OSM (надёжные)

| Тип | OSM Tag | Сила барьера | Эффект на catchment |
|-----|---------|-------------|---------------------|
| Широкая дорога | `highway=primary/trunk + lanes>=4` | Сильный | Отрезает crossStreet catchment |
| Железная дорога | `railway=rail` (не metro) | Сильный | Физический барьер |
| Река/канал | `waterway=river/canal` | Сильный | Разрывает пешеходный доступ |
| Промышленный забор | `barrier=wall + industrial` | Средний | Блокирует микро-catchment |
| Парк/закрытая зона | `leisure=park + access!=yes` | Средний | Направляет поток вокруг |
| Автострада | `highway=motorway` | Сильный | Непреодолимый барьер |

### Что НЕ является реальным барьером в OSM
- `landuse=industrial` без физического забора — только сигнал, не барьер
- `highway=residential` — не барьер
- Изменение высоты рельефа — OSM не даёт elevation data для этого

---

## 6. Anchor Zones

**Anchor zone** — пространственный кластер magnet-объектов, который «тянет» поток в свою сторону.

### Что детектируется уже сейчас
- `detectClusterZones()` — группирует magnets в радиусе 520 м
- `strongestMagnets` — топ-3 по attraction score

### Что нужно добавить для commercial
**Directional anchor label:**  
Для каждого сильного magnet (weight ≥ 5.0) определять:  
- Направление от точки (N/S/E/W или sector bearing)  
- Расстояние (в кольцах: ≤100м / ≤250м / ≤500м)

**Пример:**  
«Metro (Тверская) — 180 м на Север — основной входящий вектор»  
«Shopping Mall — 420 м на Восток — destination anchor зоны»

---

## 7. Что реально считается сейчас vs. что является proxy

| Компонент | Статус | Комментарий |
|-----------|--------|-------------|
| Magnets в радиусах 450–2000 м | ✅ Реально считается | Precise distances, decay function |
| Foot traffic shares (transit/local/dest) | ⚠️ Proxy | Из типов магнитов, не реального GPS |
| Barriers (river, railway, primary road) | ⚠️ Proxy | OSM tags, не реальная пешеходная проходимость |
| Corridor type (highway tags) | ⚠️ Proxy | Тип дороги, не измеренный поток |
| Frontage density (local nodes ≤ 50 м) | ⚠️ Слабый proxy | OSM может быть неполным в этом радиусе |
| Catchment ring intensity | ❌ Не считается сейчас | Нужна реализация |
| Directional anchor vectors | ❌ Не считается сейчас | Нужна реализация |
| Real pedestrian count | ❌ Требует external data | Phase 2 |
| Real vehicle traffic | ❌ Требует external data | Phase 2 |

---

## 8. Phase 2 (external data layer)

Для near-production accuracy нужны:

| Данные | Источник | Что даёт |
|--------|---------|---------|
| Pedestrian mobility (anonymized) | HERE, Mapbox, Google Footprint | Реальный пешеходный поток по кольцам |
| POI foot traffic | SafeGraph, Foursquare Places | Visit counts по POIs |
| Vehicle volume | OpenStreetMap traffic, TomTom | Авто-поток вдоль corridor |
| Land use intensity | Cadastral APIs | Точная плотность жилья/офисов |
| Accessibility routing | OSRM или Valhalla | Реальное пешеходное расстояние с барьерами |

---

## 9. Output schema (для отчёта)

```typescript
interface MicroCatchmentAnalysis {
  spatialPosition: SpatialPositionLabel;
  corridorStrength: 'strong' | 'moderate' | 'weak' | 'backstreet';
  
  rings: {
    r50:  { density: 'high' | 'medium' | 'low'; transitStop: boolean; crosswalkNear: boolean };
    r100: { density: 'high' | 'medium' | 'low'; transitNear: boolean; barrierDetected: boolean };
    r250: { primaryMagnets: string[]; residentialProxy: 'high' | 'medium' | 'low'; officeProxy: 'high' | 'medium' | 'low' };
    r500: { dominantMagnets: string[]; competitorCount: number; transitHubs: string[] };
  };
  
  barriers: Array<{
    type: 'road' | 'railway' | 'water' | 'industrial';
    direction: string;
    severity: 'hard' | 'soft';
    descriptionRu: string;
  }>;
  
  anchors: Array<{
    name: string;
    categoryId: string;
    distanceM: number;
    ring: 'r50' | 'r100' | 'r250' | 'r500';
    bearing: string; // 'north' | 'south' | 'east' | 'west'
  }>;
  
  spatialNarrativeRu: string; // 1-2 предложения для отчёта
  dataQuality: 'high' | 'medium' | 'low'; // OSM coverage confidence
  proxyWarning: string | null; // Честное предупреждение о proxy-природе данных
}
```

---

*Следующий шаг: `docs/commercial-micro-catchment-mvp-plan.md`*
