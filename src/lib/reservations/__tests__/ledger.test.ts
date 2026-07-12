import { describe, expect, it } from 'vitest';
import { rangesOverlap, safeImportFingerprint, validateStayRange } from '../ledger';
import { parseCsv, previewCsvImport } from '../csv-import';
const base={accountId:'account-1',actorId:'admin-1',sourceType:'manual' as const,propertyIds:['property-1'],unitIds:['unit-1']};
describe('canonical reservation ledger rules',()=>{
  it('uses half-open ranges for same-day turnover',()=>expect(rangesOverlap('2026-08-01','2026-08-03','2026-08-03','2026-08-05')).toBe(false));
  it('detects a real overlap deterministically',()=>expect(rangesOverlap('2026-08-01','2026-08-04','2026-08-03','2026-08-05')).toBe(true));
  it('rejects a zero-night stay',()=>expect(()=>validateStayRange('2026-08-01','2026-08-01')).toThrow('invalid_date_range'));
  it('normalizes valid dates to ISO',()=>expect(validateStayRange('2026-08-01','2026-08-03').from).toContain('2026-08-01'));
  it('creates the same safe fallback fingerprint for retries',()=>{const input={accountId:'a',propertyId:'p',unitId:'u',checkIn:'2026-08-01',checkOut:'2026-08-03',guestPhone:'+7 999 111-22-33',guestEmail:null};expect(safeImportFingerprint(input)).toBe(safeImportFingerprint({...input,guestPhone:'89991112233'}));});
  it('parses quoted CSV values',()=>expect(parseCsv('guestName,notes\n"Иван, И.","тихо, двор"')[0]).toEqual({guestName:'Иван, И.',notes:'тихо, двор'}));
  it('previews valid CSV without persistence',()=>{const rows=previewCsvImport({...base,mapping:{},csv:'propertyId,unitId,checkIn,checkOut,guestName,guestCount\nproperty-1,unit-1,2026-08-01,2026-08-03,Иван,2'});expect(rows[0].outcome).toBe('pending');expect(rows[0].input?.confirmationMode).toBe('confirmed');});
  it('reports missing property mapping',()=>{const rows=previewCsvImport({...base,mapping:{},csv:'propertyId,checkIn,checkOut,guestName\nunknown,2026-08-01,2026-08-03,Иван'});expect(rows[0].outcome).toBe('missing_property');});
  it('reports missing unit mapping',()=>{const rows=previewCsvImport({...base,mapping:{},csv:'propertyId,unitId,checkIn,checkOut,guestName\nproperty-1,unknown,2026-08-01,2026-08-03,Иван'});expect(rows[0].outcome).toBe('missing_unit');});
  it('rejects malformed dates during preview',()=>{const rows=previewCsvImport({...base,mapping:{},csv:'propertyId,checkIn,checkOut,guestName\nproperty-1,nope,2026-08-03,Иван'});expect(rows[0].outcome).toBe('rejected');});
  it('uses external id as an import idempotency key',()=>{const rows=previewCsvImport({...base,mapping:{},csv:'propertyId,checkIn,checkOut,guestName,externalReservationId\nproperty-1,2026-08-01,2026-08-03,Иван,BN-42'});expect(rows[0].input?.idempotencyKey).toBe('BN-42');});
});
