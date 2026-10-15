'use strict';
/** Explicit public-source HTTP status probe only; does not archive evidence bodies. No automatic alternate-provider fallback. */
async function acquireSources(requests, { fetchImpl, pause, allowedOrigins, delayMs = 1600 }) {
  if (!Number.isFinite(delayMs) || delayMs < 1000) throw Error('rate limit floor');
  if (!Array.isArray(requests) || requests.length > 30) throw Error('bounded request list required');
  const urls = requests.map(r => {
    const url = new URL(r.url);
    if (url.protocol !== 'https:' || url.username || url.password || !allowedOrigins.includes(url.origin)) throw Error('source not allowlisted');
    return url;
  });
  const records = [];
  for (let i = 0; i < requests.length; i++) {
    if (i) await pause(delayMs);
    let response;
    try { response = await fetchImpl(urls[i].href, { redirect: 'manual', signal: AbortSignal.timeout(12000), headers: { 'User-Agent': 'ASI-IndependentGeographyResearch/1.0 (https://asi-global.ru)' } }); }
    catch { records.push({id:requests[i].id,status:'NETWORK_UNAVAILABLE'}); break; }
    const status = response.status;
    const retryAfter = response.headers?.get('retry-after') ?? null;
    try { if (response.body) await response.body.cancel(); }
    catch { records.push({id:requests[i].id,status:'BODY_CANCEL_FAILED',httpStatus:status}); break; }
    records.push({ id: requests[i].id, status, retryAfter });
    // Stop the entire batch, not merely one host; never follow a redirect to evade controls.
    if (status !== 200) break;
  }
  return { records, notRun: requests.slice(records.length).map(r => r.id), stopped: records.length < requests.length || records.some(r => r.status !== 200) };
}
module.exports = { acquireSources };
