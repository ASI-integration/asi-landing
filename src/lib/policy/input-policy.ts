export const INPUT_POLICY_VERSION = 'v1' as const;

export const INPUT_ROLE_USER_DATA = 'user_data' as const;

export type InputPolicyContext = 'lead_field' | 'other_text' | 'comment' | 'support_question' | 'final_check';

export type SecurityFlag =
  | 'ignore_instructions_attempt'
  | 'system_rules_change_attempt'
  | 'secret_request_attempt'
  | 'status_or_potential_change_attempt'
  | 'admin_role_attempt'
  | 'hide_from_admin_attempt'
  | 'ai_rule_override_attempt'
  | 'system_instruction_impersonation';

export type QualityFlag = 'missing_required_fields' | 'low_completeness';

export type PromptInjectionReason =
  | 'attempt_to_ignore_rules'
  | 'attempt_to_change_system_rules'
  | 'request_for_secrets'
  | 'attempt_to_change_status_or_potential'
  | 'attempt_to_become_admin'
  | 'attempt_to_hide_from_admin'
  | 'attempt_to_override_ai_rules'
  | 'user_text_as_system_instruction'
  | 'multiple_suspicious_patterns';

export type ManualReviewReason =
  | 'possible_prompt_injection_repeat'
  | 'policy_security_review'
  | 'low_completeness';

export type LeadPolicyContext = {
  object_count_range?: string | null;
  object_types?: string[] | null;
  channels?: string[] | null;
  pms?: string[] | null;
  automation_processes?: string[] | null;
  time_consumers?: string[] | null;
  policy?: Partial<InputPolicyResult> | null;
};

export type InputPolicyTextMetadata = {
  field: string;
  raw_text: string;
  safe_text: string;
  security_flags: SecurityFlag[];
  possible_prompt_injection: boolean;
};

export type InputPolicyResult = {
  version: typeof INPUT_POLICY_VERSION;
  raw_text: string;
  safe_text: string;
  input_role: typeof INPUT_ROLE_USER_DATA;
  security_flags: SecurityFlag[];
  quality_flags: QualityFlag[];
  possible_prompt_injection: boolean;
  prompt_injection_reason: PromptInjectionReason | null;
  lead_completeness_score: number;
  missing_required_fields: string[];
  can_affect_status: boolean;
  can_affect_ai_prompt: boolean;
  manual_review_recommended: boolean;
  manual_review_reason: ManualReviewReason | null;
};

export type EvaluateInputPolicyInput = {
  context: InputPolicyContext;
  raw_text?: string | null;
  structured_selections?: Record<string, unknown> | null;
  telegram_user_id?: string | null;
  source?: string | null;
  current_lead_context?: LeadPolicyContext | null;
};

const REQUIRED_FIELDS: Array<keyof LeadPolicyContext> = [
  'object_count_range',
  'object_types',
  'channels',
  'pms',
  'automation_processes',
  'time_consumers',
];

const FINAL_MINIMUM_FIELDS: Array<keyof LeadPolicyContext> = [
  'object_types',
  'channels',
  'pms',
  'automation_processes',
];

const FIELD_LABELS: Record<keyof LeadPolicyContext, string> = {
  object_count_range: 'object_count_range',
  object_types: 'object_types',
  channels: 'channels',
  pms: 'pms',
  automation_processes: 'automation_processes',
  time_consumers: 'time_consumers',
  policy: 'policy',
};

const SECURITY_PATTERNS: Array<{
  flag: SecurityFlag;
  reason: PromptInjectionReason;
  patterns: RegExp[];
}> = [
  {
    flag: 'ignore_instructions_attempt',
    reason: 'attempt_to_ignore_rules',
    patterns: [
      /ignore\s+(?:all\s+)?(?:previous|prior|above|the)\s+(?:instructions|prompts?|rules?|context)/i,
      /disregard\s+(?:all\s+)?(?:previous|prior|above|the)\s+(?:instructions|prompts?|rules?|context)?/i,
      /forget\s+(?:all\s+)?(?:previous|prior|your|the)\s+(?:instructions|rules?|prompt)/i,
      /(?:игнорируй|проигнорируй|забудь|забей|отмени|сбрось)\s+(?:все\s+|всё\s+|свои\s+|эти\s+)?(?:предыдущие|прежние|правила|инструкции|системные|промпт)/i,
    ],
  },
  {
    flag: 'system_rules_change_attempt',
    reason: 'attempt_to_change_system_rules',
    patterns: [
      /(?:change|rewrite|override|replace)\s+(?:the\s+)?(?:system|rules?|policy|prompt)/i,
      /(?:измени|поменяй|перепиши|переопредели|отключи)\s+(?:системные\s+)?(?:правила|политику|промпт|ограничения)/i,
    ],
  },
  {
    flag: 'secret_request_attempt',
    reason: 'request_for_secrets',
    patterns: [
      /(?:show|reveal|print|leak|dump|expose|send|give)\s+.{0,48}(?:token|secret|password|credential|env|environment|api[\s_-]?key|system\s+prompt)/i,
      /(?:покажи|выведи|раскрой|дай|пришли|назови|скинь)\s+.{0,48}(?:токен|ключ|секрет|парол|env|окружени|системн.{0,12}промпт)/i,
    ],
  },
  {
    flag: 'status_or_potential_change_attempt',
    reason: 'attempt_to_change_status_or_potential',
    patterns: [
      /(?:set|make|give|assign)\s+.{0,48}(?:high\s+potential|potential\s+high|status|qualified|pilot)/i,
      /(?:поставь|сделай|выстави|задай|установи|присвой)\s+.{0,48}(?:высок.{0,8}потенциал|потенциал.{0,12}высок|статус|квалифицир|пилот)/i,
    ],
  },
  {
    flag: 'admin_role_attempt',
    reason: 'attempt_to_become_admin',
    patterns: [
      /(?:make|turn|promote)\s+.{0,24}(?:me\s+)?(?:admin|administrator|superuser|root)/i,
      /(?:сделай|назначь|преврати)\s+.{0,24}(?:меня\s+)?(?:админ|администратор|суперпользователь|root)/i,
    ],
  },
  {
    flag: 'hide_from_admin_attempt',
    reason: 'attempt_to_hide_from_admin',
    patterns: [
      /(?:do\s+not|don't|never)\s+.{0,36}(?:show|send|tell)\s+.{0,36}(?:admin|manager|operator)/i,
      /(?:не\s+показывай|скрой|не\s+передавай|удали)\s+.{0,48}(?:админ|администратор|оператор|менеджер)/i,
    ],
  },
  {
    flag: 'ai_rule_override_attempt',
    reason: 'attempt_to_override_ai_rules',
    patterns: [
      /(?:you\s+are\s+now|act\s+as|developer\s+mode|jailbreak|DAN\s+mode|prompt\s+injection)/i,
      /(?:ты\s+теперь|представься|режим\s+разработчика|джейлбрейк|обойди\s+правила)/i,
    ],
  },
  {
    flag: 'system_instruction_impersonation',
    reason: 'user_text_as_system_instruction',
    patterns: [
      /^(?:system|developer|assistant)\s*:/i,
      /^(?:система|разработчик|ассистент)\s*:/i,
      /<<<\s*(?:system|developer|instruction|prompt)/i,
    ],
  },
];

function hasValue(value: unknown): boolean {
  if (Array.isArray(value)) return value.some((item) => String(item ?? '').trim());
  return String(value ?? '').trim().length > 0;
}

export function getMissingRequiredLeadFields(context?: LeadPolicyContext | null): string[] {
  return REQUIRED_FIELDS
    .filter((field) => !hasValue(context?.[field]))
    .map((field) => FIELD_LABELS[field]);
}

export function getMissingFinalMinimumFields(context?: LeadPolicyContext | null): string[] {
  return FINAL_MINIMUM_FIELDS
    .filter((field) => !hasValue(context?.[field]))
    .map((field) => FIELD_LABELS[field]);
}

export function getLeadCompletenessScore(context?: LeadPolicyContext | null): number {
  const filled = REQUIRED_FIELDS.filter((field) => hasValue(context?.[field])).length;
  return Math.round((filled / REQUIRED_FIELDS.length) * 100);
}

function detectSecurity(text: string): { flags: SecurityFlag[]; reason: PromptInjectionReason | null } {
  const flags: SecurityFlag[] = [];
  const reasons: PromptInjectionReason[] = [];
  for (const rule of SECURITY_PATTERNS) {
    if (rule.patterns.some((pattern) => pattern.test(text))) {
      flags.push(rule.flag);
      reasons.push(rule.reason);
    }
  }
  return {
    flags,
    reason: reasons.length > 1 ? 'multiple_suspicious_patterns' : reasons[0] ?? null,
  };
}

function hasPreviousPromptInjection(context?: LeadPolicyContext | null): boolean {
  return Boolean(context?.policy?.possible_prompt_injection);
}

export function evaluateInputPolicy(input: EvaluateInputPolicyInput): InputPolicyResult {
  const rawText = (input.raw_text ?? '').toString();
  const safeText = rawText.trim();
  const { flags, reason } = detectSecurity(safeText);
  const possiblePromptInjection = flags.length > 0;
  const missingRequiredFields = getMissingRequiredLeadFields(input.current_lead_context);
  const leadCompletenessScore = getLeadCompletenessScore(input.current_lead_context);
  const qualityFlags: QualityFlag[] = [];

  if (missingRequiredFields.length) qualityFlags.push('missing_required_fields');
  if (leadCompletenessScore < 67) qualityFlags.push('low_completeness');

  const repeatedSuspicion = possiblePromptInjection && hasPreviousPromptInjection(input.current_lead_context);
  const lowCompletenessFinal = input.context === 'final_check' && getMissingFinalMinimumFields(input.current_lead_context).length > 0;

  return {
    version: INPUT_POLICY_VERSION,
    raw_text: rawText,
    safe_text: safeText,
    input_role: INPUT_ROLE_USER_DATA,
    security_flags: flags,
    quality_flags: qualityFlags,
    possible_prompt_injection: possiblePromptInjection,
    prompt_injection_reason: reason,
    lead_completeness_score: leadCompletenessScore,
    missing_required_fields: missingRequiredFields,
    can_affect_status: input.context === 'lead_field',
    can_affect_ai_prompt: false,
    manual_review_recommended: repeatedSuspicion || lowCompletenessFinal,
    manual_review_reason: repeatedSuspicion
      ? 'possible_prompt_injection_repeat'
      : lowCompletenessFinal
        ? 'low_completeness'
        : null,
  };
}

export function mergePolicyResults(base: InputPolicyResult | undefined, next: InputPolicyResult): InputPolicyResult {
  if (!base) return next;
  const securityFlags = Array.from(new Set([...base.security_flags, ...next.security_flags]));
  return {
    ...next,
    raw_text: next.raw_text,
    safe_text: next.safe_text,
    security_flags: securityFlags,
    quality_flags: next.quality_flags,
    possible_prompt_injection: base.possible_prompt_injection || next.possible_prompt_injection,
    prompt_injection_reason: next.prompt_injection_reason ?? base.prompt_injection_reason,
    manual_review_recommended: base.manual_review_recommended || next.manual_review_recommended,
    manual_review_reason: next.manual_review_reason ?? base.manual_review_reason,
  };
}

export function policyTextMetadata(field: string, policy: InputPolicyResult): InputPolicyTextMetadata {
  return {
    field,
    raw_text: policy.raw_text,
    safe_text: policy.safe_text,
    security_flags: policy.security_flags,
    possible_prompt_injection: policy.possible_prompt_injection,
  };
}
