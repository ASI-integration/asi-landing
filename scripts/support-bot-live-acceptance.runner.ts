import { runSupportBotAcceptanceFull } from '@/lib/communication/support-bot-acceptance';

async function main() {
  const result = await runSupportBotAcceptanceFull();
  if (!result.ok) {
    for (const failure of result.failures) {
      console.error('  -', failure);
    }
    process.exit(1);
  }
  console.log('[support-bot-acceptance] runner ok');
}

main().catch((error) => {
  console.error('[support-bot-acceptance] runner failed', error);
  process.exit(1);
});
