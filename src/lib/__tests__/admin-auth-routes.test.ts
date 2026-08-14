import { readFileSync } from 'node:fs';
import path from 'node:path';
import { describe, expect, it } from 'vitest';

const PROTECTED_ROUTES = [
  'src/app/api/admin/apply-readiness-gate/route.ts',
  'src/app/api/admin/booking-ops-backfill/route.ts',
  'src/app/api/admin/ops-tasks/route.ts',
  'src/app/api/admin/property-knowledge/route.ts',
  'src/app/api/admin/property-templates/route.ts',
  'src/app/api/admin/recover-stay-flow/route.ts',
  'src/app/api/admin/reservation-readiness/route.ts',
  'src/app/api/admin/reservation/route.ts',
  'src/app/api/admin/reset-demo-user/route.ts',
  'src/app/api/admin/resolve-escalation/route.ts',
  'src/app/api/admin/run-stay-flow/route.ts',
  'src/app/api/admin/telegram-webhook-info/route.ts',
  'src/app/api/admin/telegram-webhook-set/route.ts',
  'src/app/api/admin/unit-state/route.ts',
  'src/app/api/admin/update-ops-task/route.ts',
  'src/app/api/admin/update-unit-state/route.ts',
  'src/app/api/admin/upsert-property-knowledge/route.ts',
  'src/app/api/admin/upsert-property-templates/route.ts',
  'src/app/api/admin/upsert-reservation/route.ts',
  'src/app/api/dev/voice/simulate/route.ts',
] as const;

const DOWNSTREAM_MARKERS = [
  'await req.json()',
  'new URL(req.url)',
  'process.env.TELEGRAM_BOT_TOKEN',
  'runStayFlowAdvancement()',
  'bcrypt.hash(',
] as const;

describe('ADMIN_SECRET protected routes', () => {
  it('uses the shared auth boundary before downstream work in every protected route', () => {
    for (const routePath of PROTECTED_ROUTES) {
      const source = readFileSync(path.resolve(routePath), 'utf8');
      const handlerIndex = source.indexOf('export async function');
      const authIndex = source.indexOf('requireAdminSecret(req)', handlerIndex);

      expect(source, routePath).toContain("import { requireAdminSecret } from '@/lib/admin-auth';");
      expect(handlerIndex, routePath).toBeGreaterThanOrEqual(0);
      expect(authIndex, routePath).toBeGreaterThan(handlerIndex);
      expect(source, routePath).not.toContain('process.env.ADMIN_SECRET');

      for (const marker of DOWNSTREAM_MARKERS) {
        const markerIndex = source.indexOf(marker, handlerIndex);
        if (markerIndex >= 0) expect(authIndex, `${routePath}: ${marker}`).toBeLessThan(markerIndex);
      }
    }
  });
});
