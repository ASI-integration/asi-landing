import { beforeEach, describe, expect, it, vi } from 'vitest';
import { NextRequest } from 'next/server';
const boundary=vi.hoisted(()=>({create:vi.fn(), session:vi.fn(), get:vi.fn(), process:vi.fn(), unlock:vi.fn()}));
vi.mock('@/lib/auth',()=>({isSessionSecretConfigured:()=>true,getSession:boundary.session}));
vi.mock('@/lib/location/report-request-store',()=>({createLocationReportRequest:boundary.create,getLocationReportRequestById:boundary.get,markLocationReportRequestPaymentUnlocked:boundary.unlock}));
vi.mock('@/lib/location/paid-report-orchestration',()=>({processPaidReportRequest:boundary.process}));
import { POST as requestReport } from '../route';
import { POST as processReport } from '../../process/route';
beforeEach(()=>{ vi.clearAllMocks(); boundary.session.mockResolvedValue({userId:'synthetic-user'});boundary.create.mockResolvedValue({requestId:'synthetic-request'}); delete process.env.LOCATION_REPORT_MANUAL_CONFIRM_KEY; });
describe('caller cannot mint paid report authorization',()=>{
  it.each(['included','unknown',undefined,'paid_required'])('tier %s remains pending even for authenticated caller',async access_tier=>{
    const result=await requestReport(new NextRequest('http://fixture/request',{method:'POST',body:JSON.stringify({address:'synthetic',access_tier})}));
    expect(result.status).toBe(200);
    expect((await result.json()).paymentStatus).toBe('pending_payment');
    expect(boundary.create.mock.calls[0][0].accessTier).toBe('paid_required');
  });
  it.each(['included','unknown',undefined])('anonymous tier %s cannot create',async access_tier=>{
    boundary.session.mockResolvedValue({});
    const result=await requestReport(new NextRequest('http://fixture/request',{method:'POST',body:JSON.stringify({address:'synthetic',access_tier})}));
    expect(result.status).toBe(401);expect(boundary.create).not.toHaveBeenCalled();
  });
  it.each(['included','unknown'])('legacy auto-unlocked tier %s needs trusted reconfirmation',async access_tier=>{
    boundary.get.mockResolvedValue({id:'synthetic-request',access_tier,payment_status:'paid_unlocked',locale:'en',status:'queued'});
    const result=await processReport(new NextRequest('http://fixture/process',{method:'POST',body:JSON.stringify({requestId:'synthetic-request'})}));
    expect(result.status).toBe(403);expect(boundary.process).not.toHaveBeenCalled();
  });
  it.each(['included','unknown','paid_required'])('unpaid persisted tier %s cannot trigger calculation',async access_tier=>{
    boundary.get.mockResolvedValue({id:'synthetic-request',access_tier,payment_status:'created',locale:'en',status:'queued'});
    const result=await processReport(new NextRequest('http://fixture/process',{method:'POST',body:JSON.stringify({requestId:'synthetic-request'})}));
    expect(result.status).toBe(403);expect(boundary.process).not.toHaveBeenCalled();expect(boundary.unlock).not.toHaveBeenCalled();
  });
});
