/** Advisory RU residential decisions. Never an executable authorization token. */
export const REASONS = {
  verified: 'Canonical evidence supports the proposed step.',
  stage_complete: 'This stage is already complete; no action is proposed.',
  unavailable: 'The required state could not be determined.',
  malformed: 'The canonical result is incomplete or invalid.',
  identity_unresolved: 'An operator must clarify the conversation identity.',
  scope_mismatch: 'Evidence does not belong to the requested account, property or booking.',
  state_changed: 'Ownership or operational state changed during the read.',
  stale: 'Evidence has expired or has an invalid observation time.',
  conflicting: 'Current sources disagree.',
  sensitive: 'Sensitive evidence requires the existing protected operator workflow.',
  untrusted: 'The source cannot establish current operational truth.',
  missing: 'Required evidence is missing.',
  operator_controlled: 'The existing domain requires operator verification.',
  domain_blocker: 'A canonical domain check blocks this step.',
  domain_warning: 'A canonical domain warning must be reviewed.',
  manual_control: 'A canonical manual control remains in force.',
  legal_blocked: 'The canonical legal guard blocks check-in instructions.',
  property_not_ready: 'Property readiness is unresolved.',
  access_unverified: 'Access has not been verified.',
  cleaning_incomplete: 'Cleaning is incomplete.',
  access_issue: 'An access or lock issue needs operator action.',
  maintenance_issue: 'A maintenance issue needs operator action.',
  guest_complaint: 'A guest complaint is unresolved.',
  late_checkout: 'An operator must verify a late checkout request.',
  lost_item: 'An operator must verify and coordinate a lost item.',
  noise_complaint: 'An operator must review a noise complaint.',
  deposit_dispute: 'A deposit dispute requires operator review.',
  other_incident: 'An unclassified incident requires operator review.',
  open_incident: 'Unresolved incidents prevent booking closeout.',
  deposit_unresolved: 'Deposit return is only prepared or otherwise unresolved.',
  close_prerequisites: 'Canonical booking closeout prerequisites remain incomplete.',
  checkout_pending: 'Checkout has not yet been confirmed.',
  provider_unavailable: 'The spatial provider could not establish the required evidence.',
  spatial_blocker: 'A residential spatial validation check failed.',
  spatial_warning: 'Residential spatial coverage is limited.',
  spatial_manual: 'An operator must verify residential spatial evidence.',
  address_available: 'The property address must be verified.',
  coordinates_valid: 'The property coordinates must be verified.',
  address_coordinates_consistent: 'The address and map point disagree.',
  geography_available: 'The city or country is missing.',
  location_provenance: 'The property location source is not current or trusted.',
  evidence_provenance: 'The map evidence source is not current or trusted.',
  entity_provenance: 'A nearby map object lacks current trusted evidence.',
  evidence_radius_scope: 'Map evidence does not cover the requested area.',
  conflicting_entity_evidence: 'Sources disagree about a nearby map object.',
  confirm_address_and_map_point: 'An operator must confirm the address and map point.',
  operator_verified_spatial_evidence: 'Spatial evidence depends on manual verification.',
  partial_provider_coverage: 'The map provider covers only part of the requested evidence.',
  verify_missing_map_coverage: 'An operator must verify missing map coverage.',
  residential_only: 'This adapter only accepts RU residential property evidence.',
  process_error: 'The communication processor reported an error.',
  process_noop: 'No further communication action is proposed.',
  draft_only: 'Verified facts may support an operator draft; automatic guest delivery is forbidden.',
  advisory_only: 'Re-read canonical state and enforce domain permissions before any action.',
} as const;
export type DecisionReason = keyof typeof REASONS;
export const ACTIONS = ['prepare_operator_draft', 'request_operator_review', 'clarify_identity',
  'remediate', 'review_pilot', 'release_instructions', 'release_access', 'confirm_checkout',
  'record_deposit_resolved', 'close_booking', 'review_location', 'resolve_incident',
  'approve_late_checkout', 'discard_lost_item', 'charge_deposit', 'send_guest_automatically'] as const;
export type DecisionAction = typeof ACTIONS[number];
export const TOPICS = ['communication', 'pilot', 'pre_checkin', 'checkin', 'in_stay',
  'checkout', 'deposit', 'closeout', 'location', 'incident'] as const;
export type DecisionTopic = typeof TOPICS[number];
export type DecisionStatus = 'allowed' | 'blocked' | 'review_required' | 'unavailable';
export type DecisionTrust = 'verified' | 'review_required' | 'unavailable' | 'conflicting';
export type DecisionIdentity =
  | Readonly<{ kind: 'identified'; accountId: string; propertyId: string; bookingId?: string; guestId?: string; sessionId?: string }>
  | Readonly<{ kind: 'unidentified'; sessionId: string }>;
export const SOURCES = ['communication_facts', 'ops_launch', 'ops_operational', 'pre_checkin',
  'checkin', 'legal_guard', 'checkout', 'close_prerequisites', 'spatial_validation', 'stay_issue'] as const;
/** Index into the source snapshot under identity; never a URL, secret or message body. */
export type DecisionEvidence = Readonly<{
  source: typeof SOURCES[number]; index: number; observedAt: string;
  /** Canonical incident row UUID, never a user-supplied locator or credential. */
  recordId?: string;
  origin: 'canonical' | 'external' | 'manual' | 'unknown';
}>;
export type PlatformDecision = Readonly<{
  version: 'platform-decision-v0';
  identity: DecisionIdentity;
  domain: 'communication' | 'residential_ops' | 'residential_location';
  topic: DecisionTopic;
  status: DecisionStatus;
  trust: DecisionTrust;
  evidence: readonly DecisionEvidence[];
  blockers: readonly DecisionReason[];
  limitations: readonly DecisionReason[];
  manualControls: readonly DecisionReason[];
  requiresHumanReview: boolean;
  review: Readonly<{ verify: readonly DecisionReason[]; afterVerification: 'recompute_with_canonical_domain' }>;
  permission: Readonly<{
    allowedActions: readonly DecisionAction[]; forbiddenActions: readonly DecisionAction[];
    automaticActionAllowed: false; executionAuthority: 'domain_revalidation_required';
  }>;
  audit: Readonly<{ createdAt: string; reasons: readonly DecisionReason[] }>;
}>;
const isObject = (v: unknown): v is Record<string, unknown> => !!v && typeof v === 'object' && !Array.isArray(v);
const exactKeys = (v: Record<string, unknown>, required: string[], optional: string[] = []) =>
  required.every(k => Object.hasOwn(v, k)) && Object.keys(v).every(k => required.includes(k) || optional.includes(k));
const id = (v: unknown): v is string => typeof v === 'string' && /^[a-zA-Z0-9][a-zA-Z0-9_.:@-]{0,127}$/.test(v);
export const validTime = (v: unknown): v is string => typeof v === 'string' && /^\d{4}-\d\d-\d\dT/.test(v) && Number.isFinite(Date.parse(v));
export function validIdentity(v: unknown): v is DecisionIdentity {
  if (!isObject(v)) return false;
  if (v.kind === 'unidentified') return exactKeys(v, ['kind', 'sessionId']) && id(v.sessionId);
  return v.kind === 'identified' && exactKeys(v, ['kind', 'accountId', 'propertyId'], ['bookingId', 'guestId', 'sessionId'])
    && Object.entries(v).every(([k, value]) => k === 'kind' || id(value));
}
export function sameIdentity(a: DecisionIdentity, b: DecisionIdentity): boolean {
  return validIdentity(a) && validIdentity(b)
    && ['kind', 'accountId', 'propertyId', 'bookingId', 'guestId', 'sessionId'].every(k =>
      (a as unknown as Record<string, unknown>)[k] === (b as unknown as Record<string, unknown>)[k]);
}
export function isFresh(observedAt: unknown, now: number, maxAge = 60_000): boolean {
  return validTime(observedAt) && Number.isFinite(now) && now >= Date.parse(observedAt) && now - Date.parse(observedAt) <= maxAge;
}
function enumArray<T extends string>(v: unknown, values: readonly T[]): v is T[] {
  return Array.isArray(v) && v.every(x => values.includes(x)) && new Set(v).size === v.length;
}
export function isPlatformDecision(v: unknown): v is PlatformDecision {
  if (!isObject(v) || !exactKeys(v, ['version', 'identity', 'domain', 'topic', 'status', 'trust', 'evidence',
    'blockers', 'limitations', 'manualControls', 'requiresHumanReview', 'review', 'permission', 'audit'])) return false;
  if (v.version !== 'platform-decision-v0' || !validIdentity(v.identity)
    || !['communication', 'residential_ops', 'residential_location'].includes(String(v.domain))
    || !TOPICS.includes(v.topic as DecisionTopic)
    || !['allowed', 'blocked', 'review_required', 'unavailable'].includes(String(v.status))
    || !['verified', 'review_required', 'unavailable', 'conflicting'].includes(String(v.trust))) return false;
  const domain = v.topic === 'communication' ? 'communication' : v.topic === 'location' ? 'residential_location' : 'residential_ops';
  if (domain !== v.domain) return false;
  const reasonKeys = Object.keys(REASONS);
  if (![v.blockers, v.limitations, v.manualControls].every(x => enumArray(x, reasonKeys))) return false;
  if (!Array.isArray(v.evidence) || !v.evidence.every(e => isObject(e)
    && exactKeys(e, ['source', 'index', 'observedAt', 'origin'], ['recordId'])
    && (e.recordId === undefined || (typeof e.recordId === 'string' && /^[0-9a-f]{8}(-[0-9a-f]{4}){3}-[0-9a-f]{12}$/i.test(e.recordId)))
    && (e.source !== 'stay_issue' || e.recordId !== undefined)
    && SOURCES.includes(e.source as DecisionEvidence['source']) && Number.isInteger(e.index) && Number(e.index) >= 0
    && validTime(e.observedAt) && ['canonical', 'external', 'manual', 'unknown'].includes(String(e.origin)))) return false;
  if (!isObject(v.review) || !exactKeys(v.review, ['verify', 'afterVerification'])
    || !enumArray(v.review.verify, reasonKeys) || v.review.afterVerification !== 'recompute_with_canonical_domain') return false;
  const p = v.permission, a = v.audit;
  if (!isObject(p) || !exactKeys(p, ['allowedActions', 'forbiddenActions', 'automaticActionAllowed', 'executionAuthority'])
    || !enumArray(p.allowedActions, ACTIONS) || !enumArray(p.forbiddenActions, ACTIONS)
    || p.automaticActionAllowed !== false || p.executionAuthority !== 'domain_revalidation_required'
    || !p.forbiddenActions.includes('send_guest_automatically')) return false;
  const allowedActions = p.allowedActions, forbiddenActions = p.forbiddenActions;
  if (ACTIONS.some(x => allowedActions.includes(x) === forbiddenActions.includes(x))) return false;
  if (!isObject(a) || !exactKeys(a, ['createdAt', 'reasons']) || !validTime(a.createdAt)
    || !enumArray(a.reasons, reasonKeys) || !a.reasons.length || typeof v.requiresHumanReview !== 'boolean') return false;
  if (v.status !== 'allowed' && !v.requiresHumanReview) return false;
  if (v.status === 'allowed' && (v.trust !== 'verified' || (v.blockers as unknown[]).length || !v.evidence.length)) return false;
  if (v.status === 'unavailable' && v.trust !== 'unavailable') return false;
  if (v.requiresHumanReview && !v.review.verify.length) return false;
  if (!(v.limitations as string[]).includes('advisory_only')) return false;
  const safe = ['prepare_operator_draft', 'request_operator_review', 'clarify_identity', 'remediate', 'review_pilot', 'review_location'];
  if (v.status !== 'allowed' && p.allowedActions.some(x => !safe.includes(x))) return false;
  if (v.identity.kind === 'unidentified' && (v.topic !== 'communication' || v.status !== 'review_required'
    || v.evidence.length || p.allowedActions.some(x => x !== 'clarify_identity'))) return false;
  if (v.topic === 'communication' && p.allowedActions.some(x => !['prepare_operator_draft', 'request_operator_review', 'clarify_identity'].includes(x))) return false;
  const topicActions: Partial<Record<DecisionAction, DecisionTopic[]>> = {
    release_instructions: ['checkin'], release_access: ['checkin'], confirm_checkout: ['checkout'],
    record_deposit_resolved: ['deposit'], close_booking: ['closeout'], review_pilot: ['pilot'],
    review_location: ['location'], resolve_incident: ['incident'], approve_late_checkout: ['incident'],
    discard_lost_item: ['incident'], charge_deposit: ['deposit', 'incident'],
  };
  return p.allowedActions.every(x => !topicActions[x] || topicActions[x]!.includes(v.topic as DecisionTopic));
}
export function parsePlatformDecision(value: unknown): PlatformDecision {
  if (!isPlatformDecision(value)) throw new Error('invalid_platform_decision');
  return freezeDeep(JSON.parse(JSON.stringify(value)) as PlatformDecision);
}
export function freezeDeep<T>(value: T): T {
  if (value && typeof value === 'object') {
    for (const child of Object.values(value)) freezeDeep(child);
    Object.freeze(value);
  }
  return value;
}
export function makeDecision(input: {
  identity: DecisionIdentity; topic: DecisionTopic; status: DecisionStatus; now: number;
  trust?: DecisionTrust; reasons: DecisionReason[]; blockers?: DecisionReason[];
  limitations?: DecisionReason[]; manualControls?: DecisionReason[];
  allowedActions?: DecisionAction[]; evidence?: DecisionEvidence[];
}): PlatformDecision {
  const unique = <T,>(values: T[]) => [...new Set(values)];
  const review = input.status !== 'allowed' || !!input.manualControls?.length;
  const allowed = unique(input.allowedActions ?? (input.identity.kind === 'unidentified' ? ['clarify_identity'] : ['request_operator_review']));
  return parsePlatformDecision({
    version: 'platform-decision-v0', identity: input.identity,
    domain: input.topic === 'communication' ? 'communication' : input.topic === 'location' ? 'residential_location' : 'residential_ops',
    topic: input.topic, status: input.status,
    trust: input.trust ?? (input.status === 'unavailable' ? 'unavailable' : input.status === 'allowed' ? 'verified' : 'review_required'),
    evidence: input.evidence ?? [], blockers: unique(input.blockers ?? []),
    limitations: unique(['advisory_only', ...(input.limitations ?? [])]), manualControls: unique(input.manualControls ?? []),
    requiresHumanReview: review, review: { verify: review ? unique([...input.reasons, ...(input.manualControls ?? [])]) : [], afterVerification: 'recompute_with_canonical_domain' },
    permission: { allowedActions: allowed, forbiddenActions: ACTIONS.filter(a => !allowed.includes(a)),
      automaticActionAllowed: false, executionAuthority: 'domain_revalidation_required' },
    audit: { createdAt: new Date(input.now).toISOString(), reasons: unique(input.reasons) },
  });
}
export function explainDecision(value: PlatformDecision): string {
  const d = parsePlatformDecision(value);
  return d.audit.reasons.map(r => REASONS[r]).join(' ');
}
