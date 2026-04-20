# Commercial Spatial Map — V1 Plan
**Дата:** 2026-04-19  
**Цель:** Перевести визуализацию из «несколько точек на карте» в детальную пространственную карту локации

---

## 1. Почему текущая карта не работает для commercial

Текущая карта (`computeHeatmap`) показывает:
- Цветные точки — magnets (по категориям)
- Красные точки — конкуренты
- Heatmap overlay — интенсивность влияния

**Проблема:**  
Это визуализация «что рядом», не «как устроено пространство вокруг точки».

Клиент смотрит на карту и видит: «ок, рядом есть метро и несколько ресторанов».  
Клиент НЕ видит:
- Откуда именно приходит поток
- Где барьеры
- Насколько точка находится на оси движения или в стороне
- Где hot zone концентрируется

Для commercial decision это слабо.

---

## 2. Целевое состояние — что должна показывать карта V1

### 2.1 Heatmap с коммерческим смыслом

Не просто «интенсивность магнитов», а **commercial activity heat**:
- Зоны концентрации retail/F&B (где плотно магазины/кафе)
- Транзитные коридоры (по типу highway)
- Destination hot zones (где концентрируются attraction-magnets)

**Реализация:** Пересобрать heatmap layers:
```
Layer 1: Destination density — attraction + entertainment + shopping_major
Layer 2: Transit intensity — metro + railway_station + accessibility_stops  
Layer 3: Local activity — business + food + shopping_local
```

Каждый layer — своя цветовая температура. Клиент видит структуру, а не один blob.

### 2.2 Micro-catchment rings

Добавить на карту:
```
Ring 50m:  тонкая граница — «немедленный захват»
Ring 100m: штриховая — «зона прохожих»
Ring 250m: прозрачное заполнение — «основная catchment зона»
Ring 500m: пунктир — «destination поток»
```

Цвет заполнения = intensity (чем ближе к точке, тем насыщеннее).

### 2.3 Corridor overlay

**Вдоль улиц, на которых находится точка:**
- Направление основного потока (стрелки или градиентная линия)
- Тип коридора (цветовое кодирование: pedestrian / secondary / transit-adjacent)

**Реализация:**
```typescript
// Выбираем highway-элементы, проходящие ближе 30 м от точки
// Рисуем их как highlighted lines поверх карты
// Типу highway соответствует цвет и толщина линии
```

### 2.4 Barrier visualization

**Жёсткие барьеры:**
- Реки, ж/д, широкие дороги — красная штриховая линия

**Пример:**  
На карте видно: «С западной стороны — река (30 м). Catchment с этого направления отрезана.»

**Реализация:** Overpass возвращает waterway/railway elements → рисуем как barrier overlay.

### 2.5 Anchor zones

**Крупные magnets отображаются с «зоной влияния»:**
- Вокруг metro/railway — прозрачный круг 500 м
- Вокруг attraction — 300 м
- Вокруг business cluster — 400 м

Это показывает catchment overlap — насколько точка «попадает» в зону anchor.

### 2.6 Flow direction indicator

**На карте:**
Точка получает условный «вектор входящего потока» — не реальный GPS, а spatial proxy:

```
Strongest anchor → bearing to subject point → arrow indicator
```

Пример: «Метро в 200 м на север → основной входящий вектор с севера»

Это не реальные данные о направлении, но это honesty-маркированный proxy:  
«Ожидаемое основное направление входящего пешеходного потока (proxy)»

---

## 3. Что уже есть и что нужно добавить

### Уже есть
| Компонент | Файл | Статус |
|-----------|------|--------|
| Heatmap points computation | `src/lib/location/heatmap.ts` | ✅ Работает |
| Magnet points on map | `LocationIntelligenceDemo.tsx` | ✅ Работает |
| Competitor points | `LocationIntelligenceDemo.tsx` | ✅ Работает |
| Basic heatmap overlay | Leaflet/Mapbox | ✅ Работает |

### Нужно добавить (V1)
| Компонент | Приоритет | Сложность |
|-----------|-----------|-----------|
| Multi-layer heatmap (dest/transit/local) | Высокий | Средняя |
| Catchment rings (50/100/250/500) | Высокий | Низкая |
| Barrier overlay (river/railway/road) | Высокий | Средняя |
| Highway corridor overlay | Средний | Средняя |
| Anchor zone circles | Средний | Низкая |
| Flow direction indicator | Низкий | Средняя |

### Phase 2 (external data)
| Компонент | Что нужно |
|-----------|---------|
| Real pedestrian heatmap | Mobility API |
| Vehicle traffic overlay | Traffic API |
| Visit density by POI | Foursquare/SafeGraph |
| Population density choropleth | Census/cadastral |

---

## 4. Технический план реализации

### 4.1 Multi-layer heatmap

**Текущий `computeHeatmap()`** возвращает `HeatmapPoint[]` с `intensity` и `categoryId`.  
Нужно добавить `layer`:

```typescript
export interface HeatmapPoint {
  lat: number;
  lon: number;
  intensity: number;
  type: 'magnet' | 'competitor';
  categoryId: string;
  layer: 'destination' | 'transit' | 'local';  // NEW
}

function assignHeatmapLayer(categoryId: string): HeatmapPoint['layer'] {
  switch (categoryId) {
    case 'attraction':
    case 'entertainment':
    case 'shopping_major':
    case 'stadium':
    case 'convention':
      return 'destination';
    case 'metro':
    case 'railway_station':
    case 'airport':
      return 'transit';
    default:
      return 'local';
  }
}
```

**На фронте:**  
Три separate heatmap overlays с разными цветами:
```
destination: gold/amber tones
transit:     blue/indigo tones
local:       green tones
```

Toggle buttons: «Показать: Destination / Transit / Местный / Все»

### 4.2 Catchment rings

**Чистый front-end код (Leaflet/MapLibre):**
```typescript
function drawCatchmentRings(map: L.Map, center: [number, number]) {
  const rings = [
    { radius: 50,  color: '#fbbf24', opacity: 0.4, label: '50м — немедленный захват' },
    { radius: 100, color: '#f59e0b', opacity: 0.25, label: '100м — прохожие' },
    { radius: 250, color: '#d97706', opacity: 0.15, label: '250м — основная зона' },
    { radius: 500, color: '#92400e', opacity: 0.08, label: '500м — destination поток' },
  ];
  
  for (const ring of rings) {
    L.circle(center, {
      radius: ring.radius,
      color: ring.color,
      fillColor: ring.color,
      fillOpacity: ring.opacity,
      weight: 1,
    }).addTo(map);
  }
}
```

### 4.3 Barrier overlay

**Данные** приходят из `MicroCatchmentAnalysis.barriers`.  
**Рендеринг:** `L.polyline` с красным цветом вдоль barrier elements.

```typescript
function drawBarriers(map: L.Map, barriers: BarrierItem[]) {
  for (const barrier of barriers) {
    // Render barrier line (simplified — full geometry needs OSM way coords)
    L.circle([barrier.lat, barrier.lon], {
      radius: barrier.distanceM,
      color: '#ef4444',
      fill: false,
      dashArray: '6, 6',
      weight: 2,
    }).addTo(map);
  }
}
```

### 4.4 Anchor zone circles

```typescript
function drawAnchorZones(map: L.Map, magnets: MagnetItem[]) {
  const anchors = magnets.filter(m => m.weight >= 5.0);
  for (const anchor of anchors) {
    const radius = anchor.categoryId === 'metro' ? 500
      : anchor.categoryId === 'attraction' ? 300
      : 400;
    
    L.circle([anchor.lat, anchor.lon], {
      radius,
      color: CATEGORY_COLOR[anchor.categoryId] ?? '#888',
      fillOpacity: 0.06,
      weight: 1,
    }).addTo(map);
  }
}
```

---

## 5. UI/UX для commercial map mode

### Переключатель режима карты

**Сейчас:** Одна карта с heatmap + точки  
**V1:** Две вкладки:

```
[Обзор локации]  [Коммерческая структура]
```

**Обзор локации** (текущий режим):  
Heatmap + magnets + competitors

**Коммерческая структура** (новый режим):  
Multi-layer heatmap + catchment rings + barriers + anchor zones  
+ Spatial position label вверху карты  
+ Legend panel справа

### Legend panel

```
■ Destination flow    [toggle]
■ Transit flow        [toggle]
■ Local activity      [toggle]
○ Catchment rings     [toggle]
▬ Barriers            [toggle]
◎ Anchor zones        [toggle]
```

### Spatial position badge

Поверх карты, в правом верхнем углу:
```
[Угловое место · главная улица · транзитный узел рядом]
```

---

## 6. Что явно маркируем как proxy

**В легенде карты:**
> «Радиусы catchment и направление потока рассчитаны на основе данных OpenStreetMap.  
> Не отражают реальный пешеходный маршрут и фактические объёмы трафика.  
> Для точной оценки требуется выездное обследование.»

**Отдельный tooltip при наведении на flow arrow:**
> «Ожидаемое направление входящего потока (proxy на основе расположения anchor-объектов)»

---

## 7. Что даёт карта V1 клиенту

Клиент видит:
- **Где он находится** — на main street или в переулке
- **Откуда придёт основной поток** — с севера (от метро), с востока (от mall)
- **Где его обрежет** — барьеры, которые отсекают catchment зону
- **Насколько точка «в потоке»** — радиусы показывают реальный размер catchment
- **Что формирует destination спрос** — anchor zones

**Это не просто калькулятор.** Это spatial decision tool.

---

## 8. Фазы реализации

| Фаза | Что делаем | Срок |
|------|-----------|------|
| Phase 1 | Catchment rings + anchor circles (frontend only) | 1–2 дня |
| Phase 2 | Multi-layer heatmap | 2–3 дня |
| Phase 3 | Barrier overlay (требует micro-catchment backend) | 2–3 дня |
| Phase 4 | Corridor overlay + flow direction | 2–3 дня |
| Phase 5 | Commercial map toggle UI + legend | 1–2 дня |

**Итого Phase 1–5: 8–13 дней разработки**

---

*Следующий шаг: `docs/commercial-report-v1-spec.md`*
