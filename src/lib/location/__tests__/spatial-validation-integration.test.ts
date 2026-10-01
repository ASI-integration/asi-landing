import { describe, expect, it } from 'vitest';
import { buildAnalysis, haversineMeters as legacyDistance } from '../gravity-scoring';
import { haversineMeters } from '../geometry';
import { validatePublicOsmLocation } from '../spatial-validation-osm';
import { buildCommercialReport, buildLocationStandaloneReport } from '../standalone-report';
import type { OSMElement } from '../types';
const now=new Date('2026-10-01T12:00:00Z');
const elements:OSMElement[]=[
  {type:'node',id:1,lat:59.92,lon:30.35,tags:{railway:'subway_entrance',name:'Метро'}},
  {type:'node',id:2,lat:59.921,lon:30.35,tags:{tourism:'hotel',name:'Отель'}},
  {type:'node',id:3,lat:61,lon:31,tags:{tourism:'hotel',name:'За радиусом'}},
];
const input={lat:59.92,lon:30.35,address:'Санкт-Петербург, Лиговский проспект',elements,observedAt:now.toISOString(),now,hadProviderFailure:false};
describe('existing pipelines share spatial validation',()=>{
  it.each(['residential','commercial'] as const)('%s persists the shared evidence contract without retuning scores', mode=>{
    const analysis=buildAnalysis(elements,input.lat,input.lon,{spatialFoundation:mode==='commercial'});
    const before=analysis.evergreenIndex;
    analysis.locationValidation=validatePublicOsmLocation({...input,mode});
    expect(analysis.locationValidation.ok).toBe(true);
    expect(analysis.locationValidation.automated).toBe(false);
    expect(analysis.locationValidation.nearby.some(e=>e.name==='За радиусом')).toBe(false);
    const report=mode==='commercial'?buildCommercialReport({address:input.address,analysis}):buildLocationStandaloneReport({address:input.address,analysis,verdict:'Preview',reportMode:'free'});
    expect(report.locationValidation).toEqual(analysis.locationValidation);
    expect(analysis.evergreenIndex).toBe(before);
    expect(report.locationValidation?.provenance.some(p=>p.reference==='https://www.openstreetmap.org/node/1')).toBe(true);
  });
  it.each(['residential','commercial'] as const)('%s provider outage is not zero-competitor success',mode=>{
    const result=validatePublicOsmLocation({...input,mode,elements:[],hadProviderFailure:true});
    expect(result.ok).toBe(false);expect(result.counts.competitor).toBeUndefined();
  });
  it('legacy cache missing raw facts is explicitly unverified',()=>{
    const result=validatePublicOsmLocation({...input,mode:'residential',elements:undefined,cached:true});
    expect(result.ok).toBe(false);expect(result.blockers).toContain('raw_evidence_unavailable');
  });
  it('synthetic centre or sample provider cannot masquerade as real',()=>{
    for(const override of [{coordinatesSynthetic:true},{source:'sample-cache'}]){
      expect(validatePublicOsmLocation({...input,mode:'commercial',...override}).ok).toBe(false);
    }
  });
  it('shared distance retains known Devyatkino/Ligovsky calculation and units',()=>{
    expect(legacyDistance).toBe(haversineMeters);
    const distance=haversineMeters(60.0503,30.4428,59.9208,30.355);
    expect(distance).toBeGreaterThan(14000);expect(distance).toBeLessThan(16000);
  });
});
