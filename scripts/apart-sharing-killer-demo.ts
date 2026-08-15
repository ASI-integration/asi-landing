import { runApartSharingKillerDemo } from '../src/lib/partner-demo/apart-sharing-killer-demo';

async function main(): Promise<void> {
  const result = await runApartSharingKillerDemo();
  process.stdout.write(`${JSON.stringify(result, null, 2)}\n`);
}

void main();
