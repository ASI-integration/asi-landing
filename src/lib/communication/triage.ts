import { IssuePriority, MessageSlots, IntentCategory } from './types';

export function classifyIssuePriority(
  text: string,
  intent: IntentCategory,
  slots: MessageSlots
): IssuePriority {
  // Emergency must bypass normal chat flow
  // Examples: lockout / flooding / gas smell / no entry access → emergency
  const emergencyKeywords = ['lockout', 'flooding', 'gas smell', 'no entry', 'fire'];
  const normalized = text.toLowerCase();
  
  if (emergencyKeywords.some(k => normalized.includes(k))) {
    return 'emergency';
  }

  if (slots.isAccessRelated && slots.isUrgent) {
    return 'emergency';
  }

  // Urgent examples: no hot water / heating failure / wifi not working during stay
  const urgentKeywords = ['no hot water', 'heating', 'wifi not working', 'broken pipe'];
  if (slots.isUrgent || urgentKeywords.some(k => normalized.includes(k))) {
    return 'urgent';
  }

  if (intent === IntentCategory.IssueReport) {
    return 'urgent'; // Defaulting explicit issue reports to urgent if not emergency
  }

  // Normal examples: late checkout request / extra towels / general questions
  const normalIntents = [
    IntentCategory.CheckOut,
    IntentCategory.UpsellRequest,
    IntentCategory.PaymentRequest,
  ];
  if (normalIntents.includes(intent) || slots.mentionsTime || slots.mentionsObject) {
    return 'normal';
  }

  // Informational examples: nearby recommendations / info-only questions
  return 'informational';
}
