import { NextResponse } from 'next/server';
import {parseIcal676,parseOtaWebhook676,verifyIngressSignature676,importInbound676} from '@/lib/booking-ops/provider-ingress-676';
import {postgresIngressStore676,readBoundedText676} from '@/lib/booking-ops/provider-gateway-store-676';
export const runtime='nodejs';
export const dynamic='force-dynamic';
export async function POST(request:Request):Promise<NextResponse>{
 const env=process.env;
 if(env.ASI_SYNTHETIC_NO_SEND!=='YES' || env.ASI_PROVIDER_676_ENABLED!=='YES'){
  return NextResponse.json({ok:false,error:'ingress_not_enabled'},{status:503});
 }
 const scope={
  accountId:env.ASI_INGRESS_676_ACCOUNT_ID??'',
  propertyId:env.ASI_INGRESS_676_PROPERTY_ID??'',
  sourceId:env.ASI_INGRESS_676_SOURCE_ID??'',
 };
 try {
  const raw=await readBoundedText676(request,512_000);
  verifyIngressSignature676(raw,request.headers.get('x-asi-ingress-timestamp'),
   request.headers.get('x-asi-ingress-signature'),env.ASI_INGRESS_676_HMAC_SECRET??'');
  const mediaType=(request.headers.get('content-type')??'').split(';')[0].toLowerCase();
  const events=mediaType==='text/calendar'
   ?parseIcal676(raw,{...scope,defaultTimezone:env.ASI_INGRESS_676_TIMEZONE})
   :mediaType==='application/json'?parseOtaWebhook676(raw,scope):null;
  if(!events) return NextResponse.json({ok:false,error:'unsupported_content_type'},{status:415});
  const result=await importInbound676(events,postgresIngressStore676());
  return NextResponse.json({ok:result.deadLetters===0,mode:'inbox_review_only',...result},
   {status:result.deadLetters?503:202});
 }catch(error){
  const reason=error instanceof Error?error.message:'ingress_failed';
  const invalidSignature=reason==='ingress_signature_denied';
  const tooLarge=reason.includes('size_limit')||reason==='payload_too_large';
  const scopeError=reason==='ingress_scope_denied';
  return NextResponse.json({ok:false,error:invalidSignature?'unauthorized':tooLarge?'payload_too_large':scopeError?'scope_denied':'invalid_provider_payload'},
   {status:invalidSignature?401:tooLarge?413:scopeError?403:400});
 }
}
