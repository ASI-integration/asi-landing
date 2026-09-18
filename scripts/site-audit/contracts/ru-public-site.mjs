/**
 * RU public-site commercial contract for Website Auditor v1.
 * Single source of truth — do not scatter these facts across crawler files.
 */

export const RU_PUBLIC_SITE_CONTRACT = Object.freeze({
  id: 'ru-public-site-v1',
  market: 'ru',
  pricing: Object.freeze({
    setupRub: 0,
    pilotDays: 14,
    pilotRub: 0,
    continuationRubPerPropertyMonth: 1000,
    setupBeforePilot: true,
    setupDoesNotConsumePilotDays: true,
    pilotStartsOnlyAfterReadiness: true,
    continuationOnlyAfterClientDecision: true,
    noAutomaticPaidTransition: true,
  }),
  productPosition: Object.freeze({
    handlesRepeatableGuestCommunication: true,
    humanHandlesJudgmentSituations: true,
    mustNotClaimProvenFullAutonomousPropertyManagement: true,
  }),
  /**
   * Homepage acquisition form expectations after one-page flow ships to production.
   * Informational by default — do not hard-fail live production until explicitly enabled.
   */
  homepageForm: Object.freeze({
    enabled: false,
    path: '/ru',
    expectedVisibleFields: ['Ваше имя', 'Телефон или Telegram', 'Количество объектов'],
    expectedCta: 'Подключить объект бесплатно',
    mustNotShowCommunityRadios: true,
  }),
});

/** Unsupported / high-risk public capability claims (MAJOR by default). */
export const UNSUPPORTED_CLAIM_PATTERNS = Object.freeze([
  {
    id: 'CLAIM_FULL_AUTOMATION',
    pattern: /полн(ая|ой|ую)\s+автоматизац/i,
    title: 'Claim of full automation',
    severity: 'major',
  },
  {
    id: 'CLAIM_PERCENT_AUTOMATION',
    pattern: /\b(99|95)\s*%\b/i,
    title: 'Percent automation capability claim',
    severity: 'major',
  },
  {
    id: 'CLAIM_WITHOUT_HUMAN',
    pattern: /без\s+человека/i,
    title: 'Claim of operation without a human',
    severity: 'major',
  },
  {
    id: 'CLAIM_FULLY_AUTONOMOUS',
    pattern: /полностью\s+автономн/i,
    title: 'Claim of full autonomy',
    severity: 'major',
  },
  {
    id: 'CLAIM_NEVER_ERRS',
    pattern: /не\s+ошибается/i,
    title: 'Claim that the system never errs',
    severity: 'major',
  },
  {
    id: 'CLAIM_NO_HALLUCINATION',
    pattern: /не\s+галлюцинирует/i,
    title: 'Claim of no hallucinations',
    severity: 'major',
  },
  {
    id: 'CLAIM_REPLACES_OPERATORS',
    pattern: /заменяет\s+оператор/i,
    title: 'Claim that ASI replaces operators',
    severity: 'major',
  },
  {
    id: 'CLAIM_LIVE_CHANNEL_MANAGER_AUTO',
    pattern: /автоматическ\w*\s+интеграц\w*\s+с\s+менеджер\w*\s+канал/i,
    title: 'Automatic Channel Manager integration presented as live',
    severity: 'major',
  },
  {
    id: 'CLAIM_LIVE_PILOT_PDF_ANALYTICS',
    pattern: /автоматическ\w*\s+(PDF|дашборд|отч[её]т)\w*.{0,40}пилот/i,
    title: 'Automatic pilot PDF/dashboard analytics presented as live',
    severity: 'major',
  },
  {
    id: 'CLAIM_AUTONOMOUS_BUSINESS_DECISIONS',
    pattern: /автономн\w*\s+(бизнес[-\s]?решени|решени\w*\s+о\s+скидк)/i,
    title: 'Autonomous business decisions claim',
    severity: 'major',
  },
  {
    id: 'CLAIM_AUTO_DISCOUNTS',
    pattern: /автоматическ\w*\s+(скидк|цен\w*\s+решени)/i,
    title: 'Automatic discount/pricing decisions claim',
    severity: 'major',
  },
]);

/** Obsolete / jargon phrases on RU acquisition surfaces. */
export const OBSOLETE_JARGON_PATTERNS = Object.freeze([
  {
    id: 'JARGON_ROUTINE_MOVES',
    pattern: /рутина\s+движется\s+автоматически/i,
    title: 'Obsolete slogan: routine moves automatically',
    severity: 'major',
  },
  {
    id: 'JARGON_OPERATIONAL_LAYER',
    pattern: /операционный\s+слой/i,
    title: 'Technical jargon: operational layer',
    severity: 'minor',
  },
  {
    id: 'JARGON_OPERATIONAL_CONTOUR',
    pattern: /операционный\s+контур/i,
    title: 'Technical jargon: operational contour',
    severity: 'minor',
  },
  {
    id: 'JARGON_PLATFORM_MODEL',
    pattern: /модель\s+платформы/i,
    title: 'Technical jargon: platform model',
    severity: 'minor',
  },
  {
    id: 'JARGON_PLATFORM_DIRECTION',
    pattern: /куда\s+движется\s+платформа/i,
    title: 'Roadmap-facing platform direction copy',
    severity: 'minor',
  },
]);

/** Sensitive credential-like patterns (mask in reports; avoid noisy false positives). */
export const SENSITIVE_PATTERNS = Object.freeze([
  {
    id: 'SENSITIVE_WIFI_PASSWORD',
    pattern: /(?:wifi|wi-?fi|вай[\s-]?фай)[^\n]{0,40}(?:пароль|password)\s*[:=]?\s*([A-Za-z0-9@#$%^&*_\-]{6,})/i,
    title: 'Possible Wi-Fi password credential in public copy',
    severity: 'critical',
  },
  {
    id: 'SENSITIVE_DOOR_CODE',
    pattern: /(?:код\s+(?:от\s+)?(?:двери|замка|подъезда)|door\s*code|access\s*code)\s*[:=]?\s*([0-9]{4,8})/i,
    title: 'Possible door/access code in public copy',
    severity: 'critical',
  },
  {
    id: 'SENSITIVE_API_TOKEN',
    pattern: /\b((?:sk|pk|api)[_-][A-Za-z0-9]{16,}|Bearer\s+[A-Za-z0-9\-._~+/]+=*)\b/i,
    title: 'Possible API key/token in public copy',
    severity: 'critical',
  },
]);

export function maskSensitive(value) {
  const s = String(value ?? '');
  if (s.length <= 4) return '***';
  return `${s.slice(0, 2)}…${s.slice(-2)}`;
}
