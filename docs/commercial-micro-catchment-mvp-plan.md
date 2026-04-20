# Commercial Micro-Catchment — MVP Implementation Plan
**Дата:** 2026-04-19  
**Версия:** mvp-plan-v1  
**Зависит от:** `docs/commercial-micro-catchment-spec.md`  
**Цель:** Что реально можно реализовать сейчас (OSM-only) без Phase 2 data

---

## 1. Scope MVP

**В MVP входит:**
- Spatial position label (тип позиции точки)
- Corridor strength (сила позиции на улице)
- Ring-based barrier detection (реки, ж/д, шоссе)
- Directional anchor labels (откуда и что тянет поток)
- Простая нарратив-строка для отчёта

**Не входит в MVP (Phase 2):**
- Реальный пешеходный подсчёт
- Точный routing с обходом барьеров
- Mobility data feeds
- Real land use density (cadastral)

---

## 2. Что нужно в OSM fetch

Текущий Overpass запрос (`src/lib/location/overpass.ts`) уже фетчит:
- Magnets (POIs, buildings)
- Competitors (hotels near subject)
- Accessibility stops (bus/tram)
- Environmental elements (для neighborhood layer)

**Нужно добавить в fetch для micro-catchment:**

```overpass
// 1. Highway types in immediate vicinity (для corridor type)
way(around:60,{lat},{lon})[highway][highway!~"^(footway|path|cycleway|steps|service|track)$"];

// 2. Barriers/obstacles
way(around:500,{lat},{lon})[barrier];
way(around:500,{lat},{lon})[railway=rail];
way(around:500,{lat},{lon})[waterway~"river|canal|stream"];
way(around:500,{lat},{lon})[highway~"primary|trunk|motorway"][lanes][lanes>=4];

// 3. Crosswalks and crossings near point
node(around:60,{lat},{lon})[highway=crossing];
node(around:60,{lat},{lon})[highway=traffic_signals];

// 4. Very local POI density (50-100m)
// Already partially covered by existing food/shopping_local queries
// May need tighter radius queries
```

**Оценка дополнительного объёма fetch:** +20–30% к текущему объёму запроса.  
Может потребовать оптимизации Overpass timeout (сейчас 15s).

---

## 3. Новый модуль: `src/lib/location/micro-catchment.ts`

```typescript
import type { OSMElement, MagnetItem } from './types';

export type SpatialPositionLabel =
  | 'high_street_corner'
  | 'high_street_mid'
  | 'transit_adjacent'
  | 'pedestrian_zone'
  | 'secondary_street'
  | 'backstreet'
  | 'auto_corridor'
  | 'mixed_context'
  | 'isolated';

export type CorridorStrength = 'strong' | 'moderate' | 'weak' | 'backstreet';

export interface BarrierItem {
  type: 'road' | 'railway' | 'water' | 'wall';
  distanceM: number;
  severity: 'hard' | 'soft';
  descriptionRu: string;
}

export interface AnchorZone {
  name: string;
  categoryId: string;
  distanceM: number;
  ring: 'r100' | 'r250' | 'r500';
}

export interface MicroCatchmentAnalysis {
  spatialPosition: SpatialPositionLabel;
  corridorStrength: CorridorStrength;
  barriers: BarrierItem[];
  anchors: AnchorZone[];
  transitStopNear: boolean;       // ≤ 100 м
  crosswalkNear: boolean;         // ≤ 60 м
  spatialNarrativeRu: string;
  dataQuality: 'high' | 'medium' | 'low';
}

export function buildMicroCatchment(
  elements: OSMElement[],
  lat: number,
  lon: number,
  magnets: MagnetItem[],
): MicroCatchmentAnalysis {
  // ... implementation
}
```

---

## 4. Логика вычисления `spatialPosition`

```typescript
function detectSpatialPosition(
  highways: HighwayFeature[],
  transitNear: boolean,
  crosswalkNear: boolean,
): SpatialPositionLabel {
  const immediate = highways.filter(h => h.distanceM <= 30);
  const hasPedestrian = immediate.some(h => h.type === 'pedestrian' || h.type === 'living_street');
  const hasPrimary = immediate.some(h => h.type === 'primary' || h.type === 'trunk');
  const hasSecondary = immediate.some(h => h.type === 'secondary' || h.type === 'tertiary');
  const hasResidential = immediate.some(h => h.type === 'residential');
  const isCorner = immediate.length >= 2 && new Set(immediate.map(h => h.name)).size >= 2;

  if (hasPedestrian) return 'pedestrian_zone';
  if (transitNear && (hasPrimary || hasSecondary)) return 'transit_adjacent';
  if (hasPrimary && isCorner) return 'high_street_corner';
  if (hasPrimary) return 'high_street_mid';
  if (hasSecondary && isCorner) return 'high_street_corner'; // secondary corner ≈ high-street
  if (hasSecondary) return 'secondary_street';
  if (hasPrimary && !isCorner) return 'auto_corridor'; // fast road without crossing
  if (hasResidential) return 'backstreet';
  if (immediate.length === 0) return 'isolated';
  return 'mixed_context';
}
```

---

## 5. Логика corridor strength

```typescript
function detectCorridorStrength(
  position: SpatialPositionLabel,
  hasTransitNear: boolean,
  density: 'high' | 'medium' | 'low',
): CorridorStrength {
  if (position === 'high_street_corner' || (position === 'transit_adjacent' && density !== 'low')) return 'strong';
  if (position === 'pedestrian_zone' || position === 'high_street_mid') return 'strong';
  if (position === 'secondary_street' && (hasTransitNear || density === 'high')) return 'moderate';
  if (position === 'secondary_street') return 'moderate';
  if (position === 'auto_corridor') return 'moderate'; // high traffic volume but low stopping
  if (position === 'backstreet' || position === 'isolated') return 'backstreet';
  return 'weak';
}
```

---

## 6. Логика barrier detection

```typescript
function detectBarriers(elements: OSMElement[], lat: number, lon: number): BarrierItem[] {
  const barriers: BarrierItem[] = [];
  
  for (const el of elements) {
    const dist = haversineToElement(el, lat, lon);
    if (dist > 500) continue;
    
    const tags = el.tags ?? {};
    
    // Hard barriers
    if (tags.railway === 'rail' && dist <= 400) {
      barriers.push({
        type: 'railway',
        distanceM: Math.round(dist),
        severity: 'hard',
        descriptionRu: `Железная дорога в ${Math.round(dist)} м — физический барьер пешеходного доступа`,
      });
    }
    
    if (['river', 'canal'].includes(tags.waterway ?? '') && dist <= 400) {
      barriers.push({
        type: 'water',
        distanceM: Math.round(dist),
        severity: 'hard',
        descriptionRu: `Водный объект в ${Math.round(dist)} м — ограничивает catchment с одной стороны`,
      });
    }
    
    // Soft barriers
    if (['primary', 'trunk', 'motorway'].includes(tags.highway ?? '')) {
      const lanes = parseInt(tags.lanes ?? '2', 10);
      if (lanes >= 4 && dist <= 200) {
        barriers.push({
          type: 'road',
          distanceM: Math.round(dist),
          severity: 'soft',
          descriptionRu: `Широкая магистраль (${lanes} полос) в ${Math.round(dist)} м — затрудняет пешеходный переход`,
        });
      }
    }
  }
  
  return barriers.slice(0, 4); // топ-4 барьера
}
```

---

## 7. Нарратив для отчёта

```typescript
function buildSpatialNarrativeRu(
  position: SpatialPositionLabel,
  corridorStrength: CorridorStrength,
  barriers: BarrierItem[],
  transitNear: boolean,
): string {
  const positionText: Record<SpatialPositionLabel, string> = {
    high_street_corner:  'Угловое место на главной торговой улице — максимальная видимость',
    high_street_mid:     'Средина главной торговой улицы — хорошая проходимость',
    transit_adjacent:    'Рядом с транспортным узлом — высокий транзитный захват',
    pedestrian_zone:     'Пешеходная зона — потоковая аудитория, нет автомобильного барьера',
    secondary_street:    'Второстепенная улица — умеренный поток, меньше случайного захвата',
    backstreet:          'Переулок или тупик — поток формируется только целенаправленными посещениями',
    auto_corridor:       'Автомобильный коридор — высокий трафик, слабая пешеходная задерживаемость',
    mixed_context:       'Смешанный контекст — тип потока зависит от ближайших magnets',
    isolated:            'Изолированная позиция — поток только целевой',
  };

  let text = positionText[position];
  
  if (barriers.length > 0) {
    const mainBarrier = barriers[0];
    text += `. ${mainBarrier.descriptionRu}`;
  }
  
  if (transitNear && position !== 'transit_adjacent') {
    text += '. Транспортная остановка в шаговой доступности усиливает поток.';
  }
  
  return text;
}
```

---

## 8. Интеграция с существующим pipeline

**Шаг 1:** Расширить Overpass query в `overpass.ts` — добавить highway/barrier fetch  
**Шаг 2:** Создать `micro-catchment.ts` с функцией `buildMicroCatchment()`  
**Шаг 3:** Вызвать в `buildAnalysis()` в `gravity-scoring.ts`  
**Шаг 4:** Добавить `microCatchment?: MicroCatchmentAnalysis` в `LocationAnalysis`  
**Шаг 5:** Подключить к `buildCommercialReport()` в `standalone-report.ts`  
**Шаг 6:** Отобразить в commercial report UI

---

## 9. Что НЕ обещаем пользователю

В UI/отчёте явно указываем:

> «Пространственный анализ основан на данных OpenStreetMap и является приближённой оценкой.  
> Точный пешеходный трафик у входа, реальные маршруты движения и исторические данные о посещаемости  
> требуют выездного обследования и/или внешних mobility-данных (Phase 2).»

---

## 10. Трудозатраты оценочно

| Задача | Оценка |
|--------|--------|
| Расширение Overpass query | 2–3 часа |
| `micro-catchment.ts` ядро | 4–6 часов |
| Интеграция в `buildAnalysis` | 1–2 часа |
| Интеграция в `buildCommercialReport` | 1–2 часа |
| UI отображение в report | 3–4 часа |
| Тесты + валидация на 5 локациях | 2–3 часа |
| **Итого** | **13–20 часов** |

---

## 11. Приоритет внедрения

1. **Сначала:** Spatial position label + corridor strength (минимальная обогащение)
2. **Затем:** Barrier detection (высокая ценность для клиентов)
3. **Последним:** Directional anchor labels (сложнее, но важно для spatial map)

---

*Следующий шаг: `docs/commercial-spatial-map-v1-plan.md`*
