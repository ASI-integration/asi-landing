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
