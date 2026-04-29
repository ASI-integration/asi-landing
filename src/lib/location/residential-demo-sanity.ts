/**
 * RU residential demo sanity layer.
 *
 * Implementation lives in the canonical rules module:
 * `src/lib/location/rules/residential-location-rules.ts`
 *
 * This file is kept as a stable import path for UI and existing tests.
 */

export type {
  ResidentialDemoAudience,
  ResidentialDemoSanity,
  ResidentialDemoVerdictTone,
} from './rules/residential-location-rules';

export {
  applyResidentialLocationRules as applyResidentialDemoSanity,
} from './rules/residential-location-rules';

