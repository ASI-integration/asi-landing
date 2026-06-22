export function sanitizeCrmMessageTextForDisplay(text: string | null | undefined): string | null {
  const raw = String(text ?? '').trim();
  if (!raw) return null;

  const cleaned = raw
    .replace(/\[photo\]/gi, '')
    .replace(/\[file:\s*[^\]]+\]/gi, '')
    .replace(/\s+/g, ' ')
    .trim();

  return cleaned || null;
}
