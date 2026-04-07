import { callLLM } from '../openai';
import { IntentCategory, IntentResult } from './types';

const INTENT_PROMPT = `Analyze the user message and identify the precise intent.
Valid intents:
- booking_inquiry: questions about booking, prices, availability
- check_in_info: questions about arrival, door codes, "how to get in"
- check_out: questions about leaving, late checkout
- issue_report: complaints, broken things, noise, urgent problems
- payment_request: wanting to pay, asking for a payment link, "I want to pay"
- upsell_request: requesting extra services (cleaning, early check-in, parking) that might cost money
- general_question: other questions about the property, Wifi, amenities
- unknown: anything else, gibberish, just "hello" without follow-up

Output ONLY a JSON object in this exact format:
{
  "intent": "<one of the valid intents above>",
  "confidence": <float between 0.0 and 1.0>
}
Provide no other text or markdown.
`;

export async function detectIntent(text: string): Promise<IntentResult> {
  if (!text.trim()) {
    return { intent: IntentCategory.Unknown, confidence: 1.0 };
  }

  // If no LLM key is configured, fall back to a deterministic heuristic.
  // This is important for RU-only runtime environments where we still need
  // stable operational routing even when LLM is disabled.
  const llmKeyPresent = Boolean(
    (process.env.LLM_API_KEY ?? process.env.OPENAI_API_KEY ?? '').trim() ||
      (process.env.LLM_FALLBACK_API_KEY ?? '').trim(),
  );

  if (!llmKeyPresent) {
    const n = text.toLowerCase();

    // Access / check-in
    if (
      n.includes('код') ||
      n.includes('доступ') ||
      n.includes('замок') ||
      n.includes('ключ') ||
      n.includes('как заселиться') ||
      n.includes('как попасть') ||
      n.includes('как войти') ||
      n.includes('заезд') ||
      n.includes('засел')
    ) {
      return { intent: IntentCategory.CheckInInfo, confidence: 0.78 };
    }

    // Checkout / late checkout
    if (n.includes('выезд') || n.includes('высел') || n.includes('поздний выезд') || n.includes('late checkout')) {
      return { intent: IntentCategory.CheckOut, confidence: 0.72 };
    }

    // Issues
    if (
      n.includes('не работает') ||
      n.includes('не открывается') ||
      n.includes('проблем') ||
      n.includes('ошибк') ||
      n.includes('сломал') ||
      n.includes('срочно') ||
      n.includes('авар')
    ) {
      return { intent: IntentCategory.IssueReport, confidence: 0.7 };
    }

    // Pricing / booking inquiry
    if (n.includes('цена') || n.includes('стоимость') || n.includes('заброни') || n.includes('бронь')) {
      return { intent: IntentCategory.BookingInquiry, confidence: 0.65 };
    }

    // Default: unknown but not zero, so we prefer clarifying question over escalation.
    return { intent: IntentCategory.Unknown, confidence: 0.55 };
  }

  try {
    const raw = await callLLM({
      systemPrompt: INTENT_PROMPT,
      userMessage: text,
    });

    if (!raw) {
      return { intent: IntentCategory.Unknown, confidence: 0.0 };
    }

    // Strip markdown blocks if any
    const clean = raw.replace(/```json/gi, '').replace(/```/g, '').trim();
    const parsed = JSON.parse(clean);

    if (Object.values(IntentCategory).includes(parsed.intent)) {
      return {
        intent: parsed.intent as IntentCategory,
        confidence: typeof parsed.confidence === 'number' ? parsed.confidence : 0.0,
      };
    }
  } catch (err) {
    console.error('[IntentRouter] Parse error:', err);
  }

  return { intent: IntentCategory.Unknown, confidence: 0.0 };
}
