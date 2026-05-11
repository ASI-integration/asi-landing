/**
 * RU residential demo sanity layer.
 *
 * Presentation caps are recorded on `LocationScoringTrace.capsApplied` and rewrite `finalScore`.
 */

export type {
  ResidentialDemoAudience,
  ResidentialDemoSanity,
  ResidentialDemoVerdictTone,
} from './rules/residential-location-rules';

export {
  computeResidentialDemoPresentation,
  applyResidentialLocationRules as applyResidentialDemoSanity,
} from './rules/residential-location-rules';

export {
  applyResidentialDemoPresentationToAnalysis,
  cloneAnalysisForResidentialDemoPatch,
} from './residential-demo-presentation';
