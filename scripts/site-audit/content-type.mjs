/**
 * Content-type helpers for Website Auditor v1.
 */

/**
 * @param {string | null | undefined} contentType
 * @returns {boolean}
 */
export function isHtmlContentType(contentType) {
  const raw = String(contentType || '')
    .split(';')[0]
    .trim()
    .toLowerCase();
  if (!raw) return false;
  return raw === 'text/html' || raw === 'application/xhtml+xml';
}

/**
 * Normalize a Content-Type header to its media type (no params).
 * @param {string | null | undefined} contentType
 * @returns {string}
 */
export function mediaType(contentType) {
  return String(contentType || '')
    .split(';')[0]
    .trim()
    .toLowerCase();
}
