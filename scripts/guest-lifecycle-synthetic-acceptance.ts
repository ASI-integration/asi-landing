import { runSyntheticGuestLifecycleAcceptance } from '../src/lib/communication/guest-lifecycle-synthetic';

async function main(): Promise<void> {
  const report = await runSyntheticGuestLifecycleAcceptance({ language: 'ru', communicationMode: 'text' });
  process.stdout.write(`${JSON.stringify(report, null, 2)}\n`);
  if (!report.ok || report.noExternalActions !== true || report.results.some((result) => result.duplicate)) {
    process.exitCode = 1;
  } else {
    process.stdout.write('GUEST_LIFECYCLE_SYNTHETIC_ACCEPTANCE_OK\n');
  }
}

void main().catch((error) => {
  process.stderr.write(`${error instanceof Error ? error.stack ?? error.message : String(error)}\n`);
  process.exitCode = 1;
});
