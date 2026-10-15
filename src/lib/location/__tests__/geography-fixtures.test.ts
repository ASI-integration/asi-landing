import fs from 'node:fs';
import path from 'node:path';
import { createHash } from 'node:crypto';
import { describe, it, expect } from 'vitest';
import { haversineMeters } from '../geometry';
const root=path.resolve('docs/location/evidence/2026-10-15');
const manifest=JSON.parse(fs.readFileSync(path.join(root,'manifest.json'),'utf8'));
const matrix=JSON.parse(fs.readFileSync(path.join(root,'evidence-matrix.json'),'utf8'));
describe('Pinned real-world geographic observations (not demand acceptance)',()=>{
 it.each(manifest)('source bytes match SHA256: $file',(entry:{file:string;sha256:string})=>{
   expect(createHash('sha256').update(fs.readFileSync(path.join(root,entry.file))).digest('hex')).toBe(entry.sha256);
 });
 it('all twelve unchanged failed assertions retain distinct stable IDs and HOLD',()=>{
   expect(matrix.failures).toHaveLength(12);
   expect(new Set(matrix.failures.map((f:any)=>f.caseId)).size).toBe(12);
   for(const f of matrix.failures){expect(f.afterStatus).toBe('failed');expect(f.groundTruth).toContain('HOLD');}
 });
 it('cached geographic distances reproduce without a provider request',()=>{
   for(const o of matrix.observations){expect(o.walkingMetres).toBeNull();expect(o.status).toBe('HOLD');
     if(o.straightLineCandidateMetres===null)continue;
     const a=o.subjectCandidates[0],b=o.poiCandidates[0];
     expect(Math.round(haversineMeters(a.lat,a.lon,b.lat,b.lon))).toBe(o.straightLineCandidateMetres);
   }
 });
 it('OSM object identity agrees with cached Sheregesh geocode',()=>{
   const raw=JSON.parse(fs.readFileSync(path.join(root,'osm-subject.json'),'utf8'));
   expect(raw.elements.some((e:any)=>e.type==='way'&&e.id===133143136)).toBe(true);
   expect(matrix.observations.find((o:any)=>o.id==='sheregesh').subjectCandidates[0].osmId).toBe(133143136);
 });
 it('nearby transit name cannot be substituted for a mountain tourism anchor',()=>{
   expect(matrix.observations.find((o:any)=>o.id==='estosadok').poiCandidates[0].type).toBe('bus_stop');
 });
});
