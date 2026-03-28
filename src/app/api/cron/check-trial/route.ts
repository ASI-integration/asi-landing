import { NextResponse } from 'next/server';
import { checkTrialExpiration } from '@/lib/trial';
import { supabase } from '@/lib/supabase';
import { sendTelegramMessage } from '@/lib/telegram';
import { sweepExpiredPaymentSessions } from '@/lib/communication/session-status';
import { runStayFlowAdvancement } from '@/lib/ops/stay-flow-runner';

const CRON_SECRET = process.env.CRON_SECRET;

export async function GET(req: Request) {
  const authHeader = req.headers.get('authorization');
  if (CRON_SECRET && authHeader !== `Bearer ${CRON_SECRET}`) {
    return NextResponse.json({ error: 'Unauthorized' }, { status: 401 });
  }

  try {
    const now = new Date();
    const twoDaysLater = new Date(now);
    twoDaysLater.setDate(twoDaysLater.getDate() + 2);

    const { data: endingSoon } = await supabase
      .from('subscriptions')
      .select('user_id')
      .eq('status', 'trial')
      .gte('trial_end', now.toISOString())
      .lte('trial_end', twoDaysLater.toISOString());

    for (const sub of endingSoon || []) {
      const { data: user } = await supabase.from('users').select('email').eq('id', sub.user_id).single();
      await sendTelegramMessage(`⏰ Trial ending in 2 days: ${user?.email ?? sub.user_id}`);
    }

    await checkTrialExpiration();

    const swept = await sweepExpiredPaymentSessions();
    if (swept > 0) {
      console.log(`[Cron] Swept ${swept} expired payment session(s)`);
    }

    const stayFlow = await runStayFlowAdvancement();
    if (stayFlow.advanced > 0 || stayFlow.re_blocked > 0 || stayFlow.failed > 0) {
      console.log(`[Cron] Stay-flow runner: advanced=${stayFlow.advanced} skipped=${stayFlow.skipped} re_blocked=${stayFlow.re_blocked} failed=${stayFlow.failed}`);
    }

    return NextResponse.json({ ok: true, sweptPaymentSessions: swept, stayFlow });
  } catch (err) {
    console.error('[Cron check-trial]', err);
    return NextResponse.json({ error: 'Cron failed' }, { status: 500 });
  }
}
