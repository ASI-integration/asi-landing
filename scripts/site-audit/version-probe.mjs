/**
 * Read-only /api/version metadata probe for Website Auditor v1.
 * Never enqueues /api/** as ordinary crawl pages.
 */

/**
 * @param {string} baseUrl
 * @param {{ fetchImpl?: typeof fetch, timeoutMs?: number }} [options]
 * @returns {Promise<{
 *   productionVersion: string,
 *   deployedSha: string | null,
 *   versionProbeUrl: string,
 *   versionProbeOk: boolean,
 *   versionProbeStatus: number | null,
 *   versionProbeError: string | null,
 * }>}
 */
export async function probeProductionVersion(baseUrl, options = {}) {
  const fetchImpl = options.fetchImpl || globalThis.fetch;
  const timeoutMs = options.timeoutMs ?? 15000;
  const origin = new URL(baseUrl).origin;
  const versionProbeUrl = `${origin}/api/version`;

  if (typeof fetchImpl !== 'function') {
    return {
      productionVersion: 'unknown',
      deployedSha: null,
      versionProbeUrl,
      versionProbeOk: false,
      versionProbeStatus: null,
      versionProbeError: 'fetch unavailable',
    };
  }

  try {
    const controller = new AbortController();
    const timer = setTimeout(() => controller.abort(), timeoutMs);
    let res;
    try {
      res = await fetchImpl(versionProbeUrl, {
        method: 'GET',
        headers: {
          Accept: 'application/json',
          'User-Agent': 'ASI-Website-Auditor/1.0 (+read-only; version probe)',
        },
        signal: controller.signal,
      });
    } finally {
      clearTimeout(timer);
    }

    const status = res.status ?? null;
    if (!res.ok) {
      return {
        productionVersion: 'unknown',
        deployedSha: null,
        versionProbeUrl,
        versionProbeOk: false,
        versionProbeStatus: status,
        versionProbeError: `HTTP ${status}`,
      };
    }

    const data = await res.json();
    const sha = typeof data?.sha === 'string' ? data.sha.trim() : '';
    if (!sha) {
      return {
        productionVersion: 'unknown',
        deployedSha: null,
        versionProbeUrl,
        versionProbeOk: true,
        versionProbeStatus: status,
        versionProbeError: 'sha missing in /api/version payload',
      };
    }

    return {
      productionVersion: sha,
      deployedSha: sha,
      versionProbeUrl,
      versionProbeOk: true,
      versionProbeStatus: status,
      versionProbeError: null,
    };
  } catch (err) {
    return {
      productionVersion: 'unknown',
      deployedSha: null,
      versionProbeUrl,
      versionProbeOk: false,
      versionProbeStatus: null,
      versionProbeError: String(err?.message || err),
    };
  }
}

/**
 * Exact SHA match against a configured allowlist (no lexicographic / ancestry compare).
 * @param {string | null | undefined} productionVersion
 * @param {readonly string[]} knownShas
 */
export function productionShaInAllowlist(productionVersion, knownShas) {
  const sha = String(productionVersion || '')
    .trim()
    .toLowerCase();
  if (!sha || sha === 'unknown') return false;
  const set = new Set(
    [...(knownShas || [])].map((s) => String(s).trim().toLowerCase()).filter(Boolean),
  );
  return set.has(sha);
}
