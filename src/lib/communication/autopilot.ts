import type { CommunicationChannel } from './types';

export type CommunicationAutopilotAction = 'auto_reply' | 'escalate' | 'needs_context';

export type CommunicationAutopilotIntent =
  | 'check_in_access'
  | 'address_instruction'
  | 'wifi'
  | 'checkout'
  | 'early_checkin_late_checkout'
  | 'urgent_access_problem'
  | 'cleaning_issue'
  | 'maintenance_issue'
  | 'unknown';

export type CommunicationAutopilotOperationsAction = {
  department: 'operator_access_support' | 'cleaning' | 'maintenance';
  priority: 'urgent' | 'normal';
  title: string;
  triggerReason: string;
};

export type CommunicationAutopilotChannel = Extract<
  CommunicationChannel,
  'telegram' | 'email' | 'phone'
>;

export type CommunicationAutopilotContext = {
  session?: {
    id?: string;
    guestName?: string;
    language?: 'ru' | 'en' | string;
  };
  booking?: {
    id?: string;
    checkInDate?: string;
    checkInTime?: string;
    checkoutTime?: string;
    earlyCheckInAvailable?: boolean;
    lateCheckoutAvailable?: boolean;
  };
  object?: {
    id?: string;
    name?: string;
    address?: string;
    accessInstructions?: string;
    accessCode?: string;
    wifiName?: string;
    wifiPassword?: string;
  };
};

export type CommunicationAutopilotMetadata = {
  intent: CommunicationAutopilotIntent;
  matchedSignals: string[];
  missingContext: string[];
  contextKeys: string[];
  channelMode: 'active' | 'foundation' | 'planned';
  urgent: boolean;
  operationsAction?: CommunicationAutopilotOperationsAction;
  policy: 'deterministic_mvp_v1';
};

export type CommunicationAutopilotDecision = {
  action: CommunicationAutopilotAction;
  confidence: number;
  replyText?: string;
  escalationReason?: string;
  metadata: CommunicationAutopilotMetadata;
};

type IntentRule = {
  intent: Exclude<CommunicationAutopilotIntent, 'unknown'>;
  confidence: number;
  patterns: RegExp[];
};

const INTENT_RULES: readonly IntentRule[] = [
  {
    intent: 'urgent_access_problem',
    confidence: 0.94,
    patterns: [
      /(can(?:not|'t)|unable|cannot)\s+(enter|get\s+in|open|access)/i,
      /(door|lock|key|code).{0,28}(does\s+not\s+work|doesn't\s+work|not\s+working|broken|stuck|wrong)/i,
      /(urgent|emergency|outside|stuck).{0,40}(access|door|lock|key|code|enter|get\s+in)/i,
    ],
  },
  {
    intent: 'early_checkin_late_checkout',
    confidence: 0.86,
    patterns: [
      /ранн(?:ий|его|ему|им)?\s+заезд/i,
      /поздн(?:ий|его|ему|им)?\s+выезд/i,
      /(заехать|заселиться)\s+(раньше|пораньше|до)/i,
      /(выехать|выезд)\s+(позже|попозже|после)/i,
      /(early\s+check[\s-]?in|late\s+check[\s-]?out)/i,
    ],
  },
  {
    intent: 'cleaning_issue',
    confidence: 0.9,
    patterns: [
      /(грязно|грязн(?:ая|ый|ое|ые)|не\s+убрано|не\s+убрали|плохо\s+убрано|уборк[аи])/i,
      /(нет|не\s+хватает|закончились).{0,28}(полотенц|туалетн(?:ой|ая)\s+бумаг|бель[ея])/i,
      /(dirty|not\s+cleaned|unclean|messy|no\s+towels?|missing\s+towels?|needs?\s+cleaning)/i,
    ],
  },
  {
    intent: 'maintenance_issue',
    confidence: 0.9,
    patterns: [
      /(сломал(?:ось|ся|ась|и)|сломано|поломка|не\s+работает|перестал[ао]?\s+работать|протекает|теч[её]т)/i,
      /(свет|душ|кран|вода|раковин|унитаз|замок|дверь|отоплен|кондиционер|розетк).{0,36}(не\s+работает|сломал(?:ось|ся|ась|и)|протекает|теч[её]т|не\s+открывается)/i,
      /(broken|does\s+not\s+work|doesn't\s+work|not\s+working|leaking|leak|no\s+light|shower|lock|maintenance)/i,
    ],
  },
  {
    intent: 'check_in_access',
    confidence: 0.88,
    patterns: [
      /(заселени[еяю]|заезд)/i,
      /как\s+(попасть|зайти|войти|заселиться)/i,
      /(код|ключи|инструкция)\s+(для\s+)?(входа|заселения|доступа)/i,
      /(check[\s-]?in|arrival|access|door\s+code|entry\s+code|key\s+instructions)/i,
      /how\s+(do|can)\s+i\s+(enter|get\s+in|check\s+in|access)/i,
    ],
  },
  {
    intent: 'address_instruction',
    confidence: 0.84,
    patterns: [
      /(address|location|directions|where\s+is|how\s+to\s+get\s+there)/i,
      /(адрес|локаци[яию]|геолокаци[яию])/i,
      /(где\s+находится|куда\s+ехать|как\s+добраться)/i,
      /инструкци[яию]/i,
    ],
  },
  {
    intent: 'wifi',
    confidence: 0.9,
    patterns: [/(wi[\s-]?fi|вай[\s-]?фай|интернет|пароль)/i],
  },
  {
    intent: 'checkout',
    confidence: 0.86,
    patterns: [/(выезд|чекаут|check[\s-]?out)/i, /до\s+скольки\s+(выехать|выезд)/i],
  },
] as const;

const CHANNEL_MODE: Record<CommunicationAutopilotChannel, CommunicationAutopilotMetadata['channelMode']> = {
  telegram: 'active',
  email: 'foundation',
  phone: 'planned',
};

export function decideCommunicationAutopilotResponse(input: {
  channel: CommunicationAutopilotChannel;
  messageText: string;
  context?: CommunicationAutopilotContext;
}): CommunicationAutopilotDecision {
  const normalizedText = normalizeText(input.messageText);
  const classification = classifyIntent(normalizedText);
  const missingContext = getMissingContext(classification.intent, input.context);
  const baseMetadata = buildMetadata({
    channel: input.channel,
    context: input.context,
    intent: classification.intent,
    matchedSignals: classification.matchedSignals,
    missingContext,
  });

  if (classification.intent === 'urgent_access_problem') {
    return {
      action: 'escalate',
      confidence: classification.confidence,
      escalationReason: 'urgent_access_problem',
      metadata: baseMetadata,
    };
  }

  if (classification.intent === 'unknown') {
    return {
      action: 'escalate',
      confidence: 0.42,
      escalationReason: 'unknown_guest_question',
      metadata: baseMetadata,
    };
  }

  if (missingContext.length > 0) {
    return {
      action: 'needs_context',
      confidence: Math.min(classification.confidence, 0.72),
      metadata: baseMetadata,
    };
  }

  return {
    action: isOperationsIntent(classification.intent) ? 'escalate' : 'auto_reply',
    confidence: classification.confidence,
    replyText: isOperationsIntent(classification.intent)
      ? undefined
      : composeRuReply(classification.intent, input.context),
    escalationReason: isOperationsIntent(classification.intent)
      ? classification.intent
      : undefined,
    metadata: baseMetadata,
  };
}

function classifyIntent(normalizedText: string): {
  intent: CommunicationAutopilotIntent;
  confidence: number;
  matchedSignals: string[];
} {
  const urgentAccessSignals = [
    /(\u043d\u0435\s+\u043c\u043e\u0433\u0443|\u043d\u0435\u0432\u043e\u0437\u043c\u043e\u0436\u043d\u043e|\u043d\u0435\s+\u043f\u043e\u043b\u0443\u0447\u0430\u0435\u0442\u0441\u044f)\s+(\u043f\u043e\u043f\u0430\u0441\u0442\u044c|\u0437\u0430\u0439\u0442\u0438|\u0432\u043e\u0439\u0442\u0438|\u043e\u0442\u043a\u0440\u044b\u0442\u044c)/i,
    /(\u043a\u043e\u0434|\u0437\u0430\u043c\u043e\u043a|\u0434\u0432\u0435\u0440\u044c|\u043a\u043b\u044e\u0447).{0,28}(\u043d\u0435\s+\u0440\u0430\u0431\u043e\u0442\u0430\u0435\u0442|\u043d\u0435\s+\u043f\u043e\u0434\u0445\u043e\u0434\u0438\u0442|\u043d\u0435\s+\u043e\u0442\u043a\u0440\u044b\u0432\u0430\u0435\u0442|\u043d\u0435\s+\u043e\u0442\u043a\u0440\u044b\u0432\u0430\u0435\u0442\u0441\u044f|\u0441\u043b\u043e\u043c\u0430\u043b[\u0430\u043e]?\u0441[\u044c\u044f]|\u0437\u0430\u043a\u043b\u0438\u043d\u0438\u043b[\u0430\u043e]?)/i,
    /(\u0441\u0440\u043e\u0447\u043d\u043e|\u044d\u043a\u0441\u0442\u0440\u0435\u043d\u043d\u043e|\u043d\u0430\s+\u0443\u043b\u0438\u0446\u0435|\u0437\u0430\u0441\u0442\u0440\u044f\u043b[\u0430\u0438]?|\u0437\u0430\u0441\u0442\u0440\u044f\u043b\u0438).{0,40}(\u0434\u043e\u0441\u0442\u0443\u043f|\u0437\u0430\u043c\u043e\u043a|\u0434\u0432\u0435\u0440\u044c|\u043a\u043e\u0434|\u043a\u043b\u044e\u0447|\u0432\u043e\u0439\u0442\u0438|\u043f\u043e\u043f\u0430\u0441\u0442\u044c)/i,
  ];
  const urgentMatches = urgentAccessSignals
    .filter((pattern) => pattern.test(normalizedText))
    .map((pattern) => pattern.source);
  if (urgentMatches.length > 0) {
    return {
      intent: 'urgent_access_problem',
      confidence: 0.94,
      matchedSignals: urgentMatches,
    };
  }

  for (const rule of INTENT_RULES) {
    const matchedSignals = rule.patterns
      .filter((pattern) => pattern.test(normalizedText))
      .map((pattern) => pattern.source);

    if (matchedSignals.length > 0) {
      return {
        intent: rule.intent,
        confidence: rule.confidence,
        matchedSignals,
      };
    }
  }

  return {
    intent: 'unknown',
    confidence: 0.38,
    matchedSignals: [],
  };
}

function getMissingContext(
  intent: CommunicationAutopilotIntent,
  context: CommunicationAutopilotContext | undefined,
): string[] {
  switch (intent) {
    case 'check_in_access':
      return missingFields([
        ['object.address', context?.object?.address],
        ['object.accessInstructions', context?.object?.accessInstructions],
      ]);
    case 'address_instruction':
      return missingFields([['object.address', context?.object?.address]]);
    case 'wifi':
      return missingFields([
        ['object.wifiName', context?.object?.wifiName],
        ['object.wifiPassword', context?.object?.wifiPassword],
      ]);
    case 'checkout':
      return missingFields([['booking.checkoutTime', context?.booking?.checkoutTime]]);
    case 'early_checkin_late_checkout':
      return missingFields([
        ['booking.earlyCheckInAvailable', context?.booking?.earlyCheckInAvailable],
        ['booking.lateCheckoutAvailable', context?.booking?.lateCheckoutAvailable],
      ]);
    case 'cleaning_issue':
    case 'maintenance_issue':
      return missingOperationalContext(context);
    case 'urgent_access_problem':
      return missingOperationalContext(context);
    case 'unknown':
      return [];
  }
}

function missingOperationalContext(context: CommunicationAutopilotContext | undefined): string[] {
  if (context?.booking?.id || context?.object?.id || context?.object?.name || context?.object?.address) {
    return [];
  }
  return ['object.id'];
}

function isOperationsIntent(
  intent: CommunicationAutopilotIntent,
): intent is 'cleaning_issue' | 'maintenance_issue' {
  return intent === 'cleaning_issue' || intent === 'maintenance_issue';
}

function composeRuReply(
  intent: Exclude<CommunicationAutopilotIntent, 'urgent_access_problem' | 'cleaning_issue' | 'maintenance_issue' | 'unknown'>,
  context: CommunicationAutopilotContext | undefined,
): string {
  switch (intent) {
    case 'check_in_access': {
      const parts = [
        `Адрес: ${context?.object?.address}.`,
        `Как попасть: ${context?.object?.accessInstructions}.`,
      ];

      if (context?.object?.accessCode) {
        parts.push(`Код доступа: ${context.object.accessCode}.`);
      }

      if (context?.booking?.checkInTime) {
        parts.push(`Заезд с ${context.booking.checkInTime}.`);
      }

      return parts.join(' ');
    }
    case 'address_instruction':
      return `Адрес: ${context?.object?.address}. Если будет сложно найти вход, напишите сюда - поможем.`;
    case 'wifi':
      return `Wi-Fi: ${context?.object?.wifiName}. Пароль: ${context?.object?.wifiPassword}.`;
    case 'checkout':
      return `Выезд до ${context?.booking?.checkoutTime}. Ключи оставьте по инструкции из заселения.`;
    case 'early_checkin_late_checkout': {
      const early = context?.booking?.earlyCheckInAvailable
        ? 'Ранний заезд сейчас возможен.'
        : 'Ранний заезд сейчас не подтвержден.';
      const late = context?.booking?.lateCheckoutAvailable
        ? 'Поздний выезд сейчас возможен.'
        : 'Поздний выезд сейчас не подтвержден.';

      return `${early} ${late} Если планы изменятся, напишите - проверим еще раз.`;
    }
  }
}

function buildMetadata(input: {
  channel: CommunicationAutopilotChannel;
  context: CommunicationAutopilotContext | undefined;
  intent: CommunicationAutopilotIntent;
  matchedSignals: string[];
  missingContext: string[];
}): CommunicationAutopilotMetadata {
  return {
    intent: input.intent,
    matchedSignals: input.matchedSignals,
    missingContext: input.missingContext,
    contextKeys: collectContextKeys(input.context),
    channelMode: CHANNEL_MODE[input.channel],
    urgent: input.intent === 'urgent_access_problem',
    operationsAction: buildOperationsAction(input.intent),
    policy: 'deterministic_mvp_v1',
  };
}

function buildOperationsAction(
  intent: CommunicationAutopilotIntent,
): CommunicationAutopilotOperationsAction | undefined {
  switch (intent) {
    case 'urgent_access_problem':
      return {
        department: 'operator_access_support',
        priority: 'urgent',
        title: 'Communication autopilot: urgent access support',
        triggerReason: 'urgent_access_problem',
      };
    case 'cleaning_issue':
      return {
        department: 'cleaning',
        priority: 'normal',
        title: 'Communication autopilot: cleaning issue',
        triggerReason: 'cleaning_issue',
      };
    case 'maintenance_issue':
      return {
        department: 'maintenance',
        priority: 'normal',
        title: 'Communication autopilot: maintenance issue',
        triggerReason: 'maintenance_issue',
      };
    default:
      return undefined;
  }
}

function collectContextKeys(context: CommunicationAutopilotContext | undefined): string[] {
  if (!context) {
    return [];
  }

  const keys: string[] = [];

  for (const scope of ['session', 'booking', 'object'] as const) {
    const value = context[scope];

    if (!value) {
      continue;
    }

    for (const key of Object.keys(value)) {
      keys.push(`${scope}.${key}`);
    }
  }

  return keys;
}

function missingFields(fields: Array<[string, unknown]>): string[] {
  return fields
    .filter(([, value]) => value === undefined || value === null || value === '')
    .map(([key]) => key);
}

function normalizeText(text: string): string {
  return text.trim().replace(/\s+/g, ' ').toLocaleLowerCase('ru-RU');
}
