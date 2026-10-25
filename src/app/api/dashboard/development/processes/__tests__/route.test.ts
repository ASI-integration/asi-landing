import { beforeEach, afterEach, describe, expect, it, vi } from 'vitest';
vi.mock('server-only',()=>({}));
const session=vi.hoisted(()=>vi.fn());
const read=vi.hoisted(()=>vi.fn());
const save=vi.hoisted(()=>vi.fn());
vi.mock('@/lib/auth',()=>({getSession:session,isSessionSecretConfigured:()=>true}));
vi.mock('@/lib/mission-control/operations-store',()=>({readOperations:read,saveOperations:save}));
beforeEach(()=>{vi.resetAllMocks();vi.stubEnv('ASI_DEVELOPMENT_OWNER_EMAILS','owner@example.invalid');vi.stubEnv('ASI_RUNTIME_INGEST_TOKEN','isolated-status-token');vi.stubEnv('INTERNAL_TEST_SECRET','');});
afterEach(()=>vi.unstubAllEnvs());
const input=()=>({schemaVersion:'asi.operations.v1',observedAt:new Date().toISOString(),records:['backup-gh','server-backups','runtime-worker'].map(id=>({id,status:'UNKNOWN',sourceUpdatedAt:null,process:'UNKNOWN',task:'UNKNOWN',completed:null,total:null,bytes:null,totalBytes:null,errors:null,archives:[]}))});
describe('owner-only operations API',()=>{
  it.each([[{},401],[{userId:'other',email:'other@example.invalid'},403]])('rejects session %j with %i before reading data',async(s,status)=>{
    session.mockResolvedValue(s);const {GET}=await import('../route');const r=await GET();expect(r.status).toBe(status);expect(read).not.toHaveBeenCalled();
  });
  it('owner receives four safe cards, pinned HOLD and canonical G2 criteria',async()=>{
    session.mockResolvedValue({userId:'owner',email:'owner@example.invalid'});read.mockResolvedValue(null);
    const {GET}=await import('../route');const r=await GET();expect(r.status).toBe(200);expect(r.headers.get('cache-control')).toContain('private, no-store');
    const body=await r.json();expect(body.cards).toHaveLength(4);expect(body.cards[1].status).toBe('HOLD');expect(body.cards[1].criteria.length).toBeGreaterThan(0);
    expect(JSON.stringify(body)).not.toMatch(/SECRET|C:\\|Bearer|privateKey/);expect(save).not.toHaveBeenCalled();
  });
  it('read failure returns bounded error, never raw exception',async()=>{
    session.mockResolvedValue({userId:'owner',email:'owner@example.invalid'});read.mockRejectedValue(Error('SECRET /home/private'));
    const {GET}=await import('../route');const r=await GET();expect(r.status).toBe(503);expect(JSON.stringify(await r.json())).not.toContain('SECRET');
  });
  it('existing ingest rejects unauthenticated and arbitrary/oversized records without storage',async()=>{
    const {POST}=await import('@/app/api/internal/mission-control/status/route');
    const req=(body:unknown,auth=false)=>new Request('https://preview.invalid/api/internal/mission-control/status',{method:'POST',headers:auth?{authorization:'Bearer isolated-status-token'}:{},body:JSON.stringify(body)});
    expect((await POST(req(input()))).status).toBe(401);
    expect((await POST(req({...input(),secret:'C:\\private'},true))).status).toBe(400);
    expect((await POST(req({...input(),secret:'x'.repeat(13000)},true))).status).toBe(400);expect(save).not.toHaveBeenCalled();
  });
  it('existing authorized transport stores only telemetry, with safe conflict errors',async()=>{
    const {POST}=await import('@/app/api/internal/mission-control/status/route');
    const req=()=>new Request('https://preview.invalid/api/internal/mission-control/status',{method:'POST',headers:{authorization:'Bearer isolated-status-token'},body:JSON.stringify(input())});
    expect((await POST(req())).status).toBe(200);expect(save).toHaveBeenCalledTimes(1);
    save.mockRejectedValue(Error('SECRET'));const failed=await POST(req());expect(failed.status).toBe(409);expect(JSON.stringify(await failed.json())).not.toContain('SECRET');
  });
});
