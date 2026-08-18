const ASI_BRAND_TOKEN = /(^|[\s([{"'«“])ASI(?=$|[\s)\]},!?;:'"»”]|[.](?:\s|$))/gi;

/**
 * Normalize text only for speech synthesis.
 *
 * The visible/user-facing text remains unchanged. The ASI brand is spoken
 * using English letter names as selected in the production voice probe.
 */
export function normalizeSpeechTextForTts(text: string): string {
  return String(text ?? '').replace(ASI_BRAND_TOKEN, (_match, prefix: string) => `${prefix}Ay Ess Eye`);
}
