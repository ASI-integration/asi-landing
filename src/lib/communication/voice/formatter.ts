type VoiceFormatOptions = {
  maxChars?: number;
};

function stripInternalIds(text: string): string {
  // Best-effort: drop obvious internal identifiers so voice never reads them aloud.
  return text
    .replace(/\b(reviewId|sessionId|reservationId|propertyId|leadId|chat_id|update_id)\s*[:=]\s*\S+/gi, '')
    .replace(/\b[a-f0-9]{8,}\b/gi, '');
}

function normalizeWhitespace(text: string): string {
  return text
    .replace(/\r\n/g, '\n')
    .replace(/[ \t]+/g, ' ')
    .replace(/\n{3,}/g, '\n\n')
    .trim();
}

function shortenSentences(text: string): string {
  // Replace heavy punctuation runs with short pauses.
  return text
    .replace(/[_*`]+/g, '')
    .replace(/[•·]+/g, '')
    .replace(/:\s*\n/g, '. ')
    .replace(/;\s+/g, '. ')
    .replace(/\s*—\s*/g, '. ')
    .replace(/\s*-\s*/g, '. ')
    .trim();
}

function keepOneQuestion(text: string): string {
  const idx = text.indexOf('?');
  if (idx === -1) return text;
  return text.slice(0, idx + 1).trim();
}

function clip(text: string, maxChars: number): string {
  if (text.length <= maxChars) return text;
  const trimmed = text.slice(0, maxChars - 1).trimEnd();
  return `${trimmed}…`;
}

export function formatVoiceSafeText(input: string, opts?: VoiceFormatOptions): string {
  const maxChars = opts?.maxChars && opts.maxChars > 40 ? opts.maxChars : 360;

  let text = String(input ?? '');
  text = normalizeWhitespace(text);
  text = stripInternalIds(text);

  // Avoid visual-only constructs for voice: lists, multiple paragraphs, etc.
  text = text.replace(/\n\n+/g, '. ');
  text = shortenSentences(text);

  // One question per turn for voice.
  if (text.includes('?')) text = keepOneQuestion(text);

  // Avoid link reading; replace with a short phrase.
  if (/https?:\/\//i.test(text)) {
    text = text.replace(/https?:\/\/\S+/gi, 'a link');
  }

  text = normalizeWhitespace(text);
  return clip(text, maxChars);
}

