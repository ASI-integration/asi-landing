import { describe, it, expect } from 'vitest';
import { buildAnalysis } from '../gravity-scoring';
import type { OSMElement } from '../types';

describe('transport anchor mapping', () => {
  it('maps major rail stations (including relations/ways via center) to railway_station magnets', () => {
    const subject = { lat: 59.9190769, lon: 30.3545641 };

    const moscowStationRelation: OSMElement = {
      type: 'relation',
      id: 1,
      center: { lat: 59.9305, lon: 30.3613 },
      tags: {
        name: 'Московский вокзал',
        railway: 'station',
      },
    };

    const vitebskyStationWay: OSMElement = {
      type: 'way',
      id: 2,
      center: { lat: 59.9207, lon: 30.3293 },
      tags: {
        name: 'Витебский вокзал',
        railway: 'station',
      },
    };

    const analysis = buildAnalysis([moscowStationRelation, vitebskyStationWay], subject.lat, subject.lon);
    const rail = analysis.magnets.filter(m => m.categoryId === 'railway_station');

    expect(rail.map(r => r.name)).toContain('Московский вокзал');
    expect(rail.map(r => r.name)).toContain('Витебский вокзал');
  });

  it('maps metro stations tagged as station=subway to metro magnets', () => {
    const subject = { lat: 59.9190769, lon: 30.3545641 };

    const metroStation: OSMElement = {
      type: 'relation',
      id: 3,
      center: { lat: 59.9169, lon: 30.3491 },
      tags: {
        name: 'Лиговский проспект',
        station: 'subway',
        railway: 'station',
      },
    };

    const analysis = buildAnalysis([metroStation], subject.lat, subject.lon);
    expect(analysis.magnets.some(m => m.categoryId === 'metro' && m.name === 'Лиговский проспект')).toBe(true);
  });
});

