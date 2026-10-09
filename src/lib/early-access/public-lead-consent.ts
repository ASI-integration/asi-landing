import { createHash } from 'node:crypto';
import { ruCompliance } from '@/config/ruCompliance';

// Hash of the exact LF-normalized policy source bundle, checked by focused tests.
// No legal copy is duplicated or changed. This attests the offered server artifact,
// not that a browser loaded/read it. Deployment/cache alignment requires acceptance.
export const PUBLIC_LEAD_POLICY_SOURCE_PATHS = [
  'src/app/ru/privacy/page.tsx',
  'src/config/ruCompliance.ts',
  'src/config/contact.ts',
] as const;
export const PUBLIC_LEAD_POLICY_SOURCE_SHA256 =
  '85cba6292d2d0bc5e82c1c2777a3dfa23b2b193ee8904639bf0d0717e9961978';

export function publicLeadConsentPolicy() {
  // Include resolved public controller values: support email can vary by build.
  const artifact = JSON.stringify([
    PUBLIC_LEAD_POLICY_SOURCE_SHA256,
    ruCompliance.fullName, ruCompliance.inn, ruCompliance.email, ruCompliance.address,
  ]);
  return {
    policyId: '/ru/privacy',
    policyVersion: 'ru-privacy-20261009-v1',
    sourceSha256: PUBLIC_LEAD_POLICY_SOURCE_SHA256,
    contentSha256: createHash('sha256').update(artifact).digest('hex'),
  } as const;
}
