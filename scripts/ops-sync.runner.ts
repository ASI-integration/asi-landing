import { syncAutoOpsTasks } from '@/lib/ops-v1/auto-tasks';

async function main(): Promise<void> {
  const sync = await syncAutoOpsTasks();
  console.log('[ops-sync] ok', {
    created: sync.created,
    scanned: sync.scanned,
    updated: sync.updated,
  });
}

main().catch((error) => {
  const detail = error instanceof Error ? error.message : String(error);
  console.error(`[ops-sync] FAIL: ${detail}`);
  process.exit(1);
});
