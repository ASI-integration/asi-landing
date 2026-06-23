import { runPilotReadinessAcceptance } from '@/lib/pilot-readiness/acceptance';

function fail(message: string): never {
  console.error(`[pilot-readiness-acceptance] FAIL: ${message}`);
  process.exit(1);
}

async function main(): Promise<void> {
  const result = await runPilotReadinessAcceptance();
  if (!result.ok) {
    for (const item of result.failures) {
      console.error(`[pilot-readiness-acceptance] - ${item}`);
    }
    fail(result.failures[0] ?? 'acceptance failed');
  }

  console.log('[pilot-readiness-acceptance] summary', {
    runId: result.runId,
    propertyId: result.propertyId,
    bookingId: result.bookingId,
    readinessBefore: result.readinessBefore,
    readinessAfter: result.readinessAfter,
    firstBookingSync: result.firstBookingSync,
    secondBookingSync: result.secondBookingSync,
    telegramOpsOk: result.telegramOps?.ok ?? null,
  });
}

main().catch((error) => {
  const detail = error instanceof Error ? error.message : String(error);
  fail(detail);
});
