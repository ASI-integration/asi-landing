# Telegram LLM Router Fallback

Telegram guest communication stays canon-first:

1. Normalize incoming Telegram text.
2. Run the deterministic Telegram guest intent canon.
3. Use the canon reply/action when confidence is high.
4. Use the LLM router only for low-confidence, unknown, or complex guest text.
5. Validate the router JSON through ASI policy before any reply/action.
6. Send exactly one final Telegram reply through the existing outbound path.

## Provider Selection

Configure the router with environment variables:

```env
LLM_ROUTER_MODE=fixed
LLM_ROUTER_PROVIDER=disabled
LLM_ROUTER_PRIMARY_PROVIDER=deepseek
LLM_ROUTER_SECONDARY_PROVIDER=openai
LLM_ROUTER_TERTIARY_PROVIDER=openai-premium
DEEPSEEK_API_KEY=
DEEPSEEK_BASE_URL=https://api.deepseek.com
DEEPSEEK_MODEL=deepseek-v4-flash
OPENAI_API_KEY=
OPENAI_MODEL=gpt-5-nano
OPENAI_PREMIUM_MODEL=gpt-5-mini
LLM_ROUTER_TIMEOUT_MS=6000
LLM_ROUTER_PRIMARY_TIMEOUT_MS=5000
LLM_ROUTER_SECONDARY_TIMEOUT_MS=6000
LLM_ROUTER_MAX_PROVIDER_ATTEMPTS=2
LLM_ROUTER_STICKY_PROVIDER_TTL_MINUTES=15
LLM_ROUTER_AUTO_FALLBACK_ENABLED=true
LLM_ROUTER_MAX_RETRIES=1
```

`LLM_ROUTER_MODE=fixed` uses only `LLM_ROUTER_PROVIDER`. `LLM_ROUTER_MODE=auto` uses the primary, secondary, and optional premium provider chain. Provider names are internal only and must never appear in guest replies.

`LLM_ROUTER_PROVIDER`, `LLM_ROUTER_PRIMARY_PROVIDER`, and chain provider variables support `deepseek`, `openai`, `openai-premium`, and `disabled`.

DeepSeek uses the Chat Completions compatible API with JSON mode:

```json
{ "response_format": { "type": "json_object" } }
```

The prompt explicitly asks for `json`, and the app still parses and validates the result. The default DeepSeek model is `deepseek-v4-flash`; legacy model names are not hardcoded.

For `openai`, the router uses `OPENAI_API_KEY` or `LLM_API_KEY`, `OPENAI_MODEL` defaulting to `gpt-5-nano`, and Structured Outputs with a strict JSON Schema when available. For `openai-premium`, the default model is `gpt-5-mini`.

## Automatic Failover

In auto mode, the router calls DeepSeek first by default. It automatically retries with OpenAI nano when the primary provider times out, returns an API error, returns malformed JSON, misses required fields, emits invalid enum values, has confidence below `0.70`, fails ASI reply validation, exposes internal details, claims a booking/code exists before backend verification, or conflicts with urgent access policy.

The premium provider is reserved for higher-risk cases such as possible urgent access, booking/code/access ambiguity, user frustration, repeated misunderstanding, or low-confidence secondary output.

When a stronger provider succeeds after a primary failure, the router stores a sticky provider for 15 minutes or the next 5 guest messages. Sticky scope prefers a verified booking id, then a conversation/session id, and falls back to Telegram chat id only when no stronger identity exists. This prevents a provider choice for one booking from leaking into a different booking in the same chat. Sticky state is internal and does not change guest-facing copy.

The router also detects misunderstanding phrases such as “ты не понял”, “я уже сказал”, “нет, не это”, “я про другое”, “мне нужен код”, and routes the next decision to a stronger provider immediately. It includes a small recent-message context when available and avoids repeating unsafe raw LLM replies.

Even when multiple providers are called internally, the existing Telegram outbound path sends exactly one final reply for one incoming update.

## Safety Rules

The app never sends a raw LLM reply directly. It rejects:

- invalid JSON or provider parse failures;
- unknown enum values;
- confidence outside `0..1`;
- confidence below `0.70` for automatic routing;
- replies that mention provider names, prompts, confidence, or implementation details;
- replies that promise unsupported actions;
- replies that claim a booking, access code, address, price, or policy exists before backend verification.

If validation fails, the bot falls back to the existing safe clarification flow.

`checkin_code_request` never escalates immediately. It asks for a booking number or booking phone, then backend policy decides what can be shown. Urgent access problems, such as a guest already at the door with a broken code or lock, still follow the urgent access escalation policy.
