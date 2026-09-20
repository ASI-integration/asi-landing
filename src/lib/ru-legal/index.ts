export {
  LEGAL_ACCEPTANCE_REQUIRED_CODE,
  RU_LEGAL_LOCALIZATION_GATE_CODE,
  acceptCurrentRuLegalDocument,
  getActiveRuAccountSpecialOffer,
  getRuLegalOnboardingStateForAccount,
  getRuLegalOnboardingStateForUser,
  hasCurrentRuLegalAcceptance,
  isRuLegalAcceptancePersistenceEnabled,
  type RuLegalAcceptanceSummary,
  type RuLegalOnboardingState,
} from './repository';
export {
  RU_LEGAL_DOCUMENTS,
  RU_OFFER_DOCUMENT,
  RU_OFFER_VERSION,
  RU_PD_CONSENT_DOCUMENT,
  RU_PD_CONSENT_VERSION,
  isRuLegalDocumentType,
  ruLegalDocumentSha256,
  type RuLegalDocument,
  type RuLegalDocumentType,
} from './documents';
