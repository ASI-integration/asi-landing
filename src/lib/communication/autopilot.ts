import type { CommunicationChannel } from './types';

export type CommunicationAutopilotAction = 'auto_reply' | 'escalate' | 'needs_context';

export type CommunicationAutopilotIntent =
  | 'check_in_access'
  | 'address_instruction'
  | 'wifi'
  | 'checkout'
  | 'early_checkin_late_checkout'
  | 'urgent_access_problem'
  | 'unknown';

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
      /(не\s+могу|невозможно|не\s+получается)\s+(попасть|зайти|войти|открыть)/i,
      /(код|замок|дверь|ключ).{0,28}(не\s+работает|не\s+подходит|не\s+открывает|сломал[асо]?ь|заклинил[ао]?)/i,
      /(срочно|экстренно|на\s+улице|застрял[аи]?|застряли).{0,40}(доступ|замок|дверь|код|ключ)/i,
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
    action: 'auto_reply',
    confidence: classification.confidence,
    replyText: composeRuReply(classification.intent, input.context),
    metadata: baseMetadata,
  };
}

function classifyIntent(normalizedText: string): {
  intent: CommunicationAutopilotIntent;
  confidence: number;
  matchedSignals: string[];
} {
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
    case 'urgent_access_problem':
    case 'unknown':
      return [];
  }
}

function composeRuReply(
  intent: Exclude<CommunicationAutopilotIntent, 'urgent_access_problem' | 'unknown'>,
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
    policy: 'deterministic_mvp_v1',
  };
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
