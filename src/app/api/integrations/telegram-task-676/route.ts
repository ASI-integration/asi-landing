import {NextResponse} from 'next/server';
import {receiveWorkerCallback676} from '@/lib/booking-ops/telegram-task-gateway-676';
import {postgresTelegramStore676,readBoundedText676} from '@/lib/booking-ops/provider-gateway-store-676';
export const runtime='nodejs';
export const dynamic='force-dynamic';
export async function POST(request:Request):Promise<NextResponse>{
 const env=process.env;
 if(env.ASI_SYNTHETIC_NO_SEND!=='YES' || env.ASI_TELEGRAM_676_ENABLED!=='YES'){
  return NextResponse.json({ok:false,error:'telegram_not_enabled'},{status:503});
 }
 try {
  const raw=await readBoundedText676(request,64_000);
  const result=await receiveWorkerCallback676(raw,request.headers.get('x-telegram-bot-api-secret-token'),
    env.ASI_TELEGRAM_676_WEBHOOK_SECRET??'',postgresTelegramStore676());
  return NextResponse.json(result,{status:result.ok?200:403});
 }catch(error) {
  const reason=error instanceof Error?error.message:'telegram_failed';
  const auth=reason==='telegram_webhook_unauthorized';
  const large=reason==='payload_too_large'||reason==='telegram_update_too_large';
  const invalid=reason.startsWith('telegram_invalid')||reason==='telegram_callback_required'||reason==='telegram_actor_not_bound';
  return NextResponse.json({ok:false,error:auth?'unauthorized':large?'payload_too_large':invalid?'invalid_update':'telegram_gateway_failed'},
    {status:auth?401:large?413:invalid?400:503});
 }
}
