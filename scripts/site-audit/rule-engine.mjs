/**
 * Deterministic rule engine for Website Auditor v1.
 */

import {
  RU_PUBLIC_SITE_CONTRACT,
  UNSUPPORTED_CLAIM_PATTERNS,
  OBSOLETE_JARGON_PATTERNS,
  SENSITIVE_PATTERNS,
  maskSensitive,
} from './contracts/ru-public-site.mjs';
import {
  hashTargetExists,
  isGoogleSearchOrRedirect,
  classifyLinkFailure,
  parseAbsoluteUrl,
  normalizeUrl,
} from './url-policy.mjs';
import { cleanVisibleText, buildHashRef } from './page-extractor.mjs';
import { productionShaInAllowlist } from './version-probe.mjs';

/**
 * @typedef {'critical'|'major'|'minor'|'info'} Severity
 * @typedef {{
 *   id: string,
 *   severity: Severity,
 *   url: string,
 *   sourcePage?: string | null,
 *   targetUrl?: string | null,
 *   category: string,
 *   title: string,
 *   evidence: string,
 *   explanation: string,
 *   action: string,
 * }} Finding
 */

function finding(partial) {
  return {
    id: partial.id,
    severity: partial.severity,
    url: partial.url,
    sourcePage: partial.sourcePage ?? partial.url ?? null,
    targetUrl: partial.targetUrl ?? null,
    category: partial.category,
    title: partial.title,
    evidence: partial.evidence,
    explanation: partial.explanation,
    action: partial.action,
  };
}

function pageText(page) {
  return cleanVisibleText(
    [page.title, ...(page.h1Texts || []), ...(page.h2Texts || []), page.visibleText || ''].join(
      '\n',
    ),
  );
}

function snippetAround(text, index, len = 80) {
  const start = Math.max(0, index - 20);
  const end = Math.min(text.length, index + len);
  return text.slice(start, end).replace(/\s+/g, ' ').trim();
}

function isAnalyzableHtmlPage(page) {
  if (page.isHtmlDocument === false) return false;
  // Default true for fixtures that omit the flag (unit tests / HTML corpus).
  return page.isHtmlDocument !== false;
}

/** Commercial contradiction detectors across a page's visible text. */
export function detectCommercialConflicts(text, url) {
  /** @type {Finding[]} */
  const out = [];
  const t = text;
  const contract = RU_PUBLIC_SITE_CONTRACT.pricing;

  // Paid pilot — tight phrases only (avoid nav "Пилот" + unrelated "оплата")
  if (
    /(?<!бес)платн[а-яё]*\s+пилот/i.test(t) ||
    /пилот[а-яё]*\s*[—\-–]?\s*(?<!бес)платн/i.test(t) ||
    /стоимость\s+пилот/i.test(t) ||
    /оплата\s+пилот/i.test(t) ||
    /пилот[^\n.]{0,25}стоит/i.test(t)
  ) {
    out.push(
      finding({
        id: 'COMMERCIAL_PAID_PILOT_CONFLICT',
        severity: 'critical',
        url,
        sourcePage: url,
        category: 'commercial-contract',
        title: 'Pilot described as paid',
        evidence: snippetAround(
          t,
          t.search(/(?<!бес)платн[а-яё]*\s+пилот|пилот[а-яё]*\s*[—\-–]?\s*(?<!бес)платн|стоимость\s+пилот|оплата\s+пилот/i),
        ),
        explanation: `Conflicts with canonical pilot cost = ${contract.pilotRub} ₽.`,
        action: 'review public copy',
      }),
    );
  }

  // Wrong pilot duration — full numbers only (do not capture "4" from inside "14")
  for (const m of t.matchAll(/(?<!\d)(\d{1,3})\s*дн(?:я|ей|е)?/gi)) {
    const nearbyStart = Math.max(0, m.index - 40);
    const nearby = t.slice(nearbyStart, m.index + m[0].length + 40);
    if (!/пилот/i.test(nearby)) continue;
    const days = Number(m[1]);
    if (!Number.isFinite(days) || days === contract.pilotDays || days > 90) continue;
    out.push(
      finding({
        id: 'COMMERCIAL_PILOT_DURATION_CONFLICT',
        severity: 'critical',
        url,
        sourcePage: url,
        category: 'commercial-contract',
        title: 'Pilot duration differs from 14 days',
        evidence: m[0],
        explanation: `Found ${days} days near pilot wording; contract requires ${contract.pilotDays} days.`,
        action: 'review public copy',
      }),
    );
  }

  // Setup consumes pilot — only explicit inclusion claims (not "не расходуют 14")
  const setupConsumesPilot =
    (/(?<!не\s)расходуют\s+14/i.test(t) ||
      /входят\s+в\s+14/i.test(t) ||
      /включаются\s+в\s+14/i.test(t) ||
      (/14\s*дн[а-яё]*[^\n.]{0,40}во\s+время\s+(настройк|подключен)/i.test(t) &&
        /(настройк|подключен)/i.test(t))) &&
    !/не\s+расходуют\s+14/i.test(t);
  if (setupConsumesPilot) {
    out.push(
      finding({
        id: 'COMMERCIAL_SETUP_CONSUMES_PILOT',
        severity: 'critical',
        url,
        sourcePage: url,
        category: 'commercial-contract',
        title: 'Implies 14-day pilot starts during setup',
        evidence: snippetAround(t, t.search(/входят\s+в\s+14|(?<!не\s)расходуют\s+14|во\s+время\s+настройк/i)),
        explanation: 'Contract: setup occurs before pilot; setup does not consume pilot days.',
        action: 'review public copy',
      }),
    );
  }

  // Wrong monthly continuation price
  const monthPrices = [
    ...t.matchAll(/(?<!\d)(\d[\d\s]{0,5})\s*₽\s*(?:\/|за)\s*объект\s*(?:\/|в)\s*месяц/gi),
  ];
  for (const m of monthPrices) {
    const n = Number(String(m[1]).replace(/\s+/g, ''));
    if (!Number.isFinite(n) || n === 0) continue;
    if (n !== contract.continuationRubPerPropertyMonth) {
      out.push(
        finding({
          id: 'COMMERCIAL_CONTINUATION_PRICE_CONFLICT',
          severity: 'critical',
          url,
          sourcePage: url,
          category: 'commercial-contract',
          title: 'Continuation monthly price differs from 1 000 ₽',
          evidence: m[0],
          explanation: `EXPECTED: continuation = ${contract.continuationRubPerPropertyMonth} ₽ / property / month only after client decision.`,
          action: 'review public copy',
        }),
      );
    }
  }

  // Auto renewal / paid transition — not "автоматический ответ"
  const autoPositive =
    /автоматическ[а-яё]*\s+(продл|переход[а-яё]*\s+на\s+оплат|списан)/i.test(t) ||
    /подписк[а-яё]*\s+автоматическ[а-яё]*\s+продл/i.test(t);
  const autoNegated =
    /автоматического\s+перехода\s+на\s+оплату\s+нет/i.test(t) ||
    /никак(ого|их)[^\n.]{0,60}автоматическ[а-яё]*\s+(продл|переход)/i.test(t) ||
    /без\s+автоматическ[а-яё]*\s+продл/i.test(t) ||
    /не\s+будет\s+автоматическ/i.test(t);
  if (autoPositive && !autoNegated) {
    out.push(
      finding({
        id: 'COMMERCIAL_AUTO_PAID_TRANSITION',
        severity: 'critical',
        url,
        sourcePage: url,
        category: 'commercial-contract',
        title: 'Automatic paid transition/renewal implied',
        evidence: snippetAround(
          t,
          t.search(/автоматическ[а-яё]*\s+(продл|переход|списан)|подписк[а-яё]*\s+автоматическ/i),
        ),
        explanation: 'Contract forbids automatic paid transition/renewal.',
        action: 'review public copy',
      }),
    );
  }

  // Alternate setup price
  const setupPrice = t.match(/(?:настройк|подключен)[а-яё\s]{0,20}[—\-–]?\s*(\d[\d\s]*)\s*₽/i);
  if (setupPrice) {
    const n = Number(String(setupPrice[1]).replace(/\s+/g, ''));
    if (Number.isFinite(n) && n !== contract.setupRub) {
      out.push(
        finding({
          id: 'COMMERCIAL_SETUP_PRICE_CONFLICT',
          severity: 'critical',
          url,
          sourcePage: url,
          category: 'commercial-contract',
          title: 'Setup/connection price differs from 0 ₽',
          evidence: setupPrice[0],
          explanation: `EXPECTED: setup = ${contract.setupRub} ₽ before pilot.`,
          action: 'review public copy',
        }),
      );
    }
  }

  return out;
}

export function detectPatternFindings(text, url, patterns, category) {
  /** @type {Finding[]} */
  const out = [];
  for (const rule of patterns) {
    const m = text.match(rule.pattern);
    if (!m) continue;
    let evidence = m[0];
    if (category === 'sensitive' && m[1]) {
      evidence = evidence.replace(m[1], maskSensitive(m[1]));
    }
    out.push(
      finding({
        id: rule.id,
        severity: rule.severity,
        url,
        sourcePage: url,
        category,
        title: rule.title,
        evidence,
        explanation:
          category === 'unsupported-claim'
            ? 'requires runtime confirmation — flagged as a high-risk public capability claim.'
            : category === 'sensitive'
              ? 'Possible credential-like value in public visible text (masked).'
              : 'Public copy clarity / obsolete positioning.',
        action:
          category === 'sensitive' ? 'remove or anonymize public credential examples' : 'review public copy',
      }),
    );
  }
  return out;
}

export function analyzePageStructure(page) {
  /** @type {Finding[]} */
  const out = [];
  const url = page.finalUrl || page.requestedUrl;

  if (!isAnalyzableHtmlPage(page)) {
    return out;
  }

  if (!page.title || !String(page.title).trim()) {
    out.push(
      finding({
        id: 'STRUCT_MISSING_TITLE',
        severity: 'major',
        url,
        sourcePage: url,
        category: 'structure',
        title: 'Missing page title',
        evidence: '(empty)',
        explanation: 'Document title is empty.',
        action: 'add a descriptive <title>',
      }),
    );
  }

  if (!page.metaDescription || !String(page.metaDescription).trim()) {
    out.push(
      finding({
        id: 'STRUCT_MISSING_META_DESCRIPTION',
        severity: 'minor',
        url,
        sourcePage: url,
        category: 'structure',
        title: 'Missing meta description',
        evidence: '(empty)',
        explanation: 'meta[name=description] is missing or empty.',
        action: 'add meta description',
      }),
    );
  }

  const h1Count = page.h1Count ?? (page.h1Texts || []).length;
  if (h1Count === 0) {
    out.push(
      finding({
        id: 'STRUCT_MISSING_H1',
        severity: 'major',
        url,
        sourcePage: url,
        category: 'structure',
        title: 'Missing visible H1',
        evidence: 'h1Count=0',
        explanation: 'Page has no visible H1.',
        action: 'add one primary H1',
      }),
    );
  } else if (h1Count > 1) {
    out.push(
      finding({
        id: 'STRUCT_DUPLICATE_H1',
        severity: 'major',
        url,
        sourcePage: url,
        category: 'structure',
        title: 'Duplicate visible H1',
        evidence: (page.h1Texts || []).join(' | '),
        explanation: `Found ${h1Count} visible H1 elements; expected exactly one where appropriate.`,
        action: 'reduce to a single H1',
      }),
    );
  }

  for (const label of page.ctaLabels || []) {
    const trimmed = String(label || '').trim();
    // Only flag controls with no letters/numbers (icon-only / punctuation-only).
    if (!trimmed || !/\p{L}|\p{N}/u.test(trimmed)) {
      out.push(
        finding({
          id: 'STRUCT_EMPTY_CTA',
          severity: 'minor',
          url,
          sourcePage: url,
          category: 'structure',
          title: 'Empty or meaningless CTA label',
          evidence: JSON.stringify(label),
          explanation: 'Interactive control has no meaningful visible label.',
          action: 'label the control',
        }),
      );
    }
  }

  return out;
}

/**
 * Normalize hash refs from page.hashRefs or legacy page.hashLinks strings.
 */
export function resolvePageHashRefs(page, baseUrl) {
  const sourceUrl = page.finalUrl || page.requestedUrl || baseUrl;
  if (Array.isArray(page.hashRefs) && page.hashRefs.length) {
    return page.hashRefs.map((ref) => ({
      href: String(ref.href || ''),
      targetUrl: String(ref.targetUrl || ''),
      hash: String(ref.hash || ''),
    }));
  }
  /** @type {{ href: string, targetUrl: string, hash: string }[]} */
  const out = [];
  for (const raw of page.hashLinks || []) {
    const built = buildHashRef(raw, sourceUrl);
    if (built) out.push(built);
  }
  return out;
}

/**
 * Validate fragment targets against the TARGET page's element IDs (not the source).
 * @param {object[]} pages
 * @param {string} baseUrl
 */
export function analyzeHashLinks(pages, baseUrl) {
  /** @type {Finding[]} */
  const out = [];
  /** @type {Map<string, object>} */
  const byNorm = new Map();
  for (const page of pages) {
    for (const candidate of [page.finalUrl, page.requestedUrl]) {
      const norm = normalizeUrl(candidate, baseUrl);
      if (norm && !byNorm.has(norm)) byNorm.set(norm, page);
    }
  }

  for (const page of pages) {
    if (!isAnalyzableHtmlPage(page)) continue;
    const sourcePage = page.finalUrl || page.requestedUrl;
    for (const ref of resolvePageHashRefs(page, baseUrl)) {
      const hash = ref.hash.includes('#') ? `#${ref.hash.split('#').pop()}` : ref.hash;
      if (!hash || hash === '#') continue;
      const targetNorm = normalizeUrl(ref.targetUrl || sourcePage, baseUrl);
      const targetPage = targetNorm ? byNorm.get(targetNorm) : null;

      if (!targetPage) {
        out.push(
          finding({
            id: 'LINK_HASH_TARGET_UNVERIFIED',
            severity: 'info',
            url: sourcePage,
            sourcePage,
            targetUrl: targetNorm || ref.targetUrl || null,
            category: 'links',
            title: 'Hash target page not crawled — unverifiable',
            evidence: `${ref.href || hash} → ${targetNorm || ref.targetUrl || '(unknown)'}`,
            explanation:
              'Target page was not in the crawl corpus (max-pages, skip, or not discovered). Not treated as a missing ID.',
            action: 're-audit with higher max-pages or open the target page directly',
          }),
        );
        continue;
      }

      if (targetPage.navigationError || (targetPage.status && targetPage.status >= 400)) {
        // Navigation/HTTP failure is reported separately — do not also claim missing ID.
        continue;
      }

      if (targetPage.isHtmlDocument === false) {
        out.push(
          finding({
            id: 'LINK_HASH_TARGET_UNVERIFIED',
            severity: 'info',
            url: sourcePage,
            sourcePage,
            targetUrl: targetNorm,
            category: 'links',
            title: 'Hash target is non-HTML — unverifiable',
            evidence: `${hash} on ${targetNorm} (contentType=${targetPage.contentType || 'unknown'})`,
            explanation: 'Fragment IDs are only validated on successfully crawled HTML documents.',
            action: 'confirm the link intent manually',
          }),
        );
        continue;
      }

      const ids = new Set(targetPage.elementIds || []);
      if (!hashTargetExists(hash, ids)) {
        out.push(
          finding({
            id: 'LINK_MISSING_HASH_TARGET',
            severity: 'major',
            url: sourcePage,
            sourcePage,
            targetUrl: targetNorm,
            category: 'links',
            title: 'Hash link target ID does not exist',
            evidence: `SOURCE: ${sourcePage} | TARGET: ${targetNorm} | HASH: ${hash}`,
            explanation: `No element with id="${hash.slice(1)}" on target page ${targetNorm}.`,
            action: 'fix anchor target or remove link',
          }),
        );
      }
    }
  }

  return out;
}

/**
 * Non-hash link checks for a single page (Google URLs, malformed hrefs).
 * Status-based failures are handled separately with referrer provenance.
 */
export function analyzeLinks(page, baseUrl) {
  /** @type {Finding[]} */
  const out = [];
  const url = page.finalUrl || page.requestedUrl;

  for (const href of [...(page.internalLinks || []), ...(page.externalLinks || [])]) {
    if (!String(href || '').trim()) continue;
    if (isGoogleSearchOrRedirect(href, baseUrl)) {
      out.push(
        finding({
          id: 'LINK_GOOGLE_SEARCH_URL',
          severity: 'critical',
          url,
          sourcePage: url,
          targetUrl: href,
          category: 'links',
          title: 'Google search/redirect URL where internal route expected',
          evidence: href,
          explanation: 'Public navigation should use internal routes/anchors, not Google URLs.',
          action: 'replace with internal route',
        }),
      );
    }
    const parsed = parseAbsoluteUrl(href, baseUrl);
    if (!parsed) {
      if (/^[a-z][a-z0-9+.-]*:/i.test(String(href)) === false && String(href).includes(' ')) {
        out.push(
          finding({
            id: 'LINK_MALFORMED_HREF',
            severity: 'major',
            url,
            sourcePage: url,
            targetUrl: String(href).slice(0, 200),
            category: 'links',
            title: 'Malformed href',
            evidence: String(href).slice(0, 120),
            explanation: 'Anchor href could not be parsed as a URL.',
            action: 'fix href',
          }),
        );
      }
    }
  }

  return out;
}

/**
 * Emit HTTP/nav failure findings with source-page provenance.
 * @param {object[]} pages
 * @param {Record<string, number|null>} linkStatusMap
 * @param {Record<string, string[]>} linkReferrers
 * @param {string} baseUrl
 */
export function analyzeLinkStatuses(pages, linkStatusMap, linkReferrers, baseUrl) {
  /** @type {Finding[]} */
  const out = [];
  const reportedTargets = new Set();

  for (const page of pages) {
    const pageUrl = page.finalUrl || page.requestedUrl;
    const pageNorm = normalizeUrl(page.requestedUrl || pageUrl, baseUrl) || page.requestedUrl;
    if (page.navigationError) {
      const sources = sortedReferrers(linkReferrers, pageNorm, page.requestedUrl, pageUrl);
      out.push(
        finding({
          id: 'LINK_NAV_FAILURE',
          severity: 'critical',
          url: sources[0] || pageUrl,
          sourcePage: sources[0] || pageUrl,
          targetUrl: pageUrl,
          category: 'links',
          title: 'Navigation failure',
          evidence: formatLinkEvidence(sources, pageUrl, page.navigationError),
          explanation: 'Page navigation failed.',
          action: 'investigate route',
        }),
      );
      reportedTargets.add(pageNorm);
      reportedTargets.add(page.requestedUrl);
    }
    if (page.status && page.status >= 400) {
      const fail = classifyLinkFailure(page.status);
      if (fail) {
        const sources = sortedReferrers(linkReferrers, pageNorm, page.requestedUrl, pageUrl);
        out.push(
          finding({
            id: page.status >= 500 ? 'LINK_INTERNAL_5XX' : 'LINK_INTERNAL_4XX',
            severity: fail.severity,
            url: sources[0] || pageUrl,
            sourcePage: sources[0] || pageUrl,
            targetUrl: pageUrl,
            category: 'links',
            title: fail.title,
            evidence: formatLinkEvidence(sources, pageUrl, `status=${page.status}`),
            explanation: 'Crawled page returned an error status.',
            action: 'fix route',
          }),
        );
        reportedTargets.add(pageNorm);
        reportedTargets.add(page.requestedUrl);
      }
    }
  }

  for (const [linkUrl, status] of Object.entries(linkStatusMap || {})) {
    const fail = classifyLinkFailure(status);
    if (!fail) continue;
    const norm = normalizeUrl(linkUrl, baseUrl) || linkUrl;
    if (reportedTargets.has(linkUrl) || reportedTargets.has(norm)) continue;
    const sources = sortedReferrers(linkReferrers, norm, linkUrl);
    out.push(
      finding({
        id: status >= 500 ? 'LINK_INTERNAL_5XX' : status == null ? 'LINK_NAV_FAILURE' : 'LINK_INTERNAL_4XX',
        severity: fail.severity,
        url: sources[0] || linkUrl,
        sourcePage: sources[0] || linkUrl,
        targetUrl: linkUrl,
        category: 'links',
        title: fail.title,
        evidence: formatLinkEvidence(sources, linkUrl, `status=${status}`),
        explanation: 'Internal GET navigation did not succeed.',
        action: 'fix route or remove dead link',
      }),
    );
  }

  return out;
}

function sortedReferrers(linkReferrers, ...keys) {
  const set = new Set();
  for (const key of keys) {
    if (!key) continue;
    for (const src of linkReferrers?.[key] || []) set.add(src);
  }
  return [...set].sort((a, b) => a.localeCompare(b));
}

function formatLinkEvidence(sources, targetUrl, statusPart) {
  const sourceLine =
    sources.length > 0 ? sources.join(', ') : '(no referrer recorded — seed or direct crawl)';
  return `SOURCE: ${sourceLine} | TARGET: ${targetUrl} | ${statusPart}`;
}

export function analyzeDuplicateTitles(pages) {
  /** @type {Finding[]} */
  const out = [];
  /** @type {Map<string, string[]>} */
  const byTitle = new Map();
  for (const page of pages) {
    if (!isAnalyzableHtmlPage(page)) continue;
    const title = String(page.title || '').trim().toLowerCase();
    if (!title) continue;
    const url = page.finalUrl || page.requestedUrl;
    if (!byTitle.has(title)) byTitle.set(title, []);
    byTitle.get(title).push(url);
  }
  for (const [title, urls] of [...byTitle.entries()].sort((a, b) => a[0].localeCompare(b[0]))) {
    const unique = [...new Set(urls)].sort();
    if (unique.length < 2) continue;
    out.push(
      finding({
        id: 'STRUCT_DUPLICATE_TITLE',
        severity: 'minor',
        url: unique[0],
        sourcePage: unique[0],
        targetUrl: unique.slice(1).join(', ') || null,
        category: 'structure',
        title: 'Duplicate document titles across public pages',
        evidence: `${title} → ${unique.join(', ')}`,
        explanation: 'Multiple distinct public URLs share the same <title>.',
        action: 'differentiate titles',
      }),
    );
  }
  return out;
}

export function analyzeNearDuplicateUrls(pages, baseUrl) {
  /** @type {Finding[]} */
  const out = [];
  const norms = new Map();
  for (const page of pages) {
    const raw = page.requestedUrl;
    const norm = normalizeUrl(raw, baseUrl);
    if (!norm) continue;
    if (!norms.has(norm)) norms.set(norm, []);
    norms.get(norm).push(raw);
  }
  for (const [norm, raws] of [...norms.entries()].sort((a, b) => a[0].localeCompare(b[0]))) {
    const unique = [...new Set(raws)].sort();
    if (unique.length < 2) continue;
    out.push(
      finding({
        id: 'LINK_NEAR_DUPLICATE_URL',
        severity: 'info',
        url: norm,
        sourcePage: unique[0],
        targetUrl: norm,
        category: 'links',
        title: 'Near-duplicate URLs after slash/hash normalization',
        evidence: unique.join(' | '),
        explanation: 'Multiple requested URLs collapse to the same normalized page key.',
        action: 'optional cleanup of alternate URL forms',
      }),
    );
  }
  return out;
}

/**
 * Resolve whether homepage form contract should be enforced.
 * @param {'auto'|'enabled'|'disabled'} mode
 * @param {string | null | undefined} productionVersion
 * @returns {{ enforce: boolean, reason: string }}
 */
export function resolveHomepageContractMode(mode, productionVersion) {
  const normalized = String(mode || 'auto').toLowerCase();
  if (normalized === 'enabled') {
    return { enforce: true, reason: 'homepage-contract=enabled' };
  }
  if (normalized === 'disabled') {
    return { enforce: false, reason: 'homepage-contract=disabled' };
  }
  // auto
  const known = RU_PUBLIC_SITE_CONTRACT.homepageForm.onePageFlowProductionShas || [];
  if (productionShaInAllowlist(productionVersion, known)) {
    return {
      enforce: true,
      reason: `auto: production SHA ${productionVersion} is in onePageFlowProductionShas`,
    };
  }
  return {
    enforce: false,
    reason: `auto: production SHA ${productionVersion || 'unknown'} not in onePageFlowProductionShas (exact match only)`,
  };
}

/**
 * Expected homepage URL from contract path + audit baseUrl.
 * @param {string} baseUrl
 */
export function expectedHomepageUrl(baseUrl) {
  const pathHint = RU_PUBLIC_SITE_CONTRACT.homepageForm.path;
  return normalizeUrl(new URL(pathHint, baseUrl).href, baseUrl);
}

/**
 * Redirect-safe homepage identity.
 * Prefer requestedUrl match (seed `/ru` even when final is `/`), then exact finalUrl.
 * Never use broad `.includes('/ru')` matching.
 * @param {object[]} pages
 * @param {string} baseUrl
 */
export function findHomepagePage(pages, baseUrl) {
  const want = expectedHomepageUrl(baseUrl);
  if (!want) return null;

  const byRequested = (pages || []).find((p) => {
    const requested = normalizeUrl(p.requestedUrl, baseUrl);
    return requested && requested === want;
  });
  if (byRequested) return byRequested;

  const byFinal = (pages || []).find((p) => {
    const finalNorm = normalizeUrl(p.finalUrl, baseUrl);
    return finalNorm && finalNorm === want;
  });
  return byFinal || null;
}

function homepageRedirectEvidence(page) {
  const requested = page?.requestedUrl || '(unknown)';
  const final = page?.finalUrl || '(unknown)';
  if (requested === final) return `requested: ${requested}`;
  return `requested: ${requested} | final: ${final}`;
}

export function analyzeHomepageFormContract(pages, baseUrl, { mode = 'auto', productionVersion = 'unknown' } = {}) {
  /** @type {Finding[]} */
  const out = [];
  const decision = resolveHomepageContractMode(mode, productionVersion);
  const pathHint = RU_PUBLIC_SITE_CONTRACT.homepageForm.path;
  const expectedUrl = expectedHomepageUrl(baseUrl) || pathHint;

  if (!decision.enforce) {
    out.push(
      finding({
        id: 'FORM_HOMEPAGE_CONTRACT_INFO',
        severity: 'info',
        url: expectedUrl,
        sourcePage: expectedUrl,
        category: 'forms',
        title: 'Homepage form contract checks not enforced',
        evidence: decision.reason,
        explanation:
          'Form field contract stays informational until production exposes a known one-page SHA or --homepage-contract enabled is passed.',
        action: 'deploy one-page homepage or pass --homepage-contract enabled',
      }),
    );
    return out;
  }

  const homepage = findHomepagePage(pages, baseUrl);

  if (!homepage || !isAnalyzableHtmlPage(homepage)) {
    out.push(
      finding({
        id: 'FORM_HOMEPAGE_MISSING',
        severity: 'major',
        url: expectedUrl,
        sourcePage: expectedUrl,
        targetUrl: expectedUrl,
        category: 'forms',
        title: 'Homepage not available for form contract',
        evidence: `${decision.reason} | expected: ${expectedUrl}`,
        explanation:
          'Homepage form enforcement was enabled but no crawled page matched the configured homepage by exact requestedUrl or finalUrl.',
        action: 'ensure the homepage path is crawled (requested identity preferred over redirect final URL)',
      }),
    );
    return out;
  }

  const requested = homepage.requestedUrl || expectedUrl;
  const final = homepage.finalUrl || requested;
  const redirectNote = homepageRedirectEvidence(homepage);
  const labels = (homepage.forms || []).flatMap((f) => f.labels || []);
  const labelBlob = labels.join('\n');
  const text = pageText(homepage);
  const expected = RU_PUBLIC_SITE_CONTRACT.homepageForm.expectedVisibleFields;

  for (const field of expected) {
    if (!labelBlob.includes(field) && !text.includes(field)) {
      out.push(
        finding({
          id: 'FORM_HOMEPAGE_FIELD_MISSING',
          severity: 'major',
          url: requested,
          sourcePage: requested,
          targetUrl: final !== requested ? final : null,
          category: 'forms',
          title: 'Expected homepage form field missing',
          evidence: `${field} | ${redirectNote}`,
          explanation: `Expected visible field "${field}" on acquisition form.`,
          action: 'restore compact 3-field form',
        }),
      );
    }
  }

  if (/участник\s+сообществ|community\s+member/i.test(text + '\n' + labelBlob)) {
    out.push(
      finding({
        id: 'FORM_HOMEPAGE_COMMUNITY_RADIOS',
        severity: 'major',
        url: requested,
        sourcePage: requested,
        targetUrl: final !== requested ? final : null,
        category: 'forms',
        title: 'Community membership radios present on homepage form',
        evidence: `community membership wording detected near form | ${redirectNote}`,
        explanation: 'Compact acquisition form must not show community membership radios.',
        action: 'remove community radios from homepage form',
      }),
    );
  }

  return out;
}

/**
 * Run all rules against crawl results.
 * @param {{
 *   pages: object[],
 *   baseUrl: string,
 *   linkStatusMap?: Record<string, number|null>,
 *   linkReferrers?: Record<string, string[]>,
 *   homepageContractMode?: 'auto'|'enabled'|'disabled',
 *   productionVersion?: string,
 * }} input
 */
export function runRuleEngine(input) {
  const pages = [...(input.pages || [])].sort((a, b) =>
    String(a.finalUrl || a.requestedUrl).localeCompare(String(b.finalUrl || b.requestedUrl)),
  );
  /** @type {Finding[]} */
  const findings = [];

  for (const page of pages) {
    const url = page.finalUrl || page.requestedUrl;
    findings.push(...analyzePageStructure(page));
    findings.push(...analyzeLinks(page, input.baseUrl));

    if (isAnalyzableHtmlPage(page) && !(page.status && page.status >= 400)) {
      const text = pageText(page);
      findings.push(...detectCommercialConflicts(text, url));
      findings.push(...detectPatternFindings(text, url, UNSUPPORTED_CLAIM_PATTERNS, 'unsupported-claim'));
      findings.push(...detectPatternFindings(text, url, OBSOLETE_JARGON_PATTERNS, 'jargon'));
      findings.push(...detectPatternFindings(text, url, SENSITIVE_PATTERNS, 'sensitive'));
    }
  }

  findings.push(...analyzeHashLinks(pages, input.baseUrl));
  findings.push(
    ...analyzeLinkStatuses(
      pages,
      input.linkStatusMap || {},
      input.linkReferrers || {},
      input.baseUrl,
    ),
  );
  findings.push(...analyzeDuplicateTitles(pages));
  findings.push(...analyzeNearDuplicateUrls(pages, input.baseUrl));
  findings.push(
    ...analyzeHomepageFormContract(pages, input.baseUrl, {
      mode: input.homepageContractMode || 'auto',
      productionVersion: input.productionVersion || 'unknown',
    }),
  );

  // Deduplicate identical findings (same id+url+evidence+target)
  const seen = new Set();
  const deduped = [];
  for (const f of findings) {
    const key = `${f.id}|${f.url}|${f.targetUrl || ''}|${f.evidence}`;
    if (seen.has(key)) continue;
    seen.add(key);
    deduped.push(f);
  }

  return sortFindings(deduped);
}

export function sortFindings(findings) {
  const severityRank = { critical: 0, major: 1, minor: 2, info: 3 };
  return [...findings].sort((a, b) => {
    const s = (severityRank[a.severity] ?? 9) - (severityRank[b.severity] ?? 9);
    if (s !== 0) return s;
    const id = a.id.localeCompare(b.id);
    if (id !== 0) return id;
    const u = a.url.localeCompare(b.url);
    if (u !== 0) return u;
    return String(a.targetUrl || '').localeCompare(String(b.targetUrl || ''));
  });
}

export function countBySeverity(findings) {
  const counts = { critical: 0, major: 0, minor: 0, info: 0 };
  for (const f of findings) {
    if (counts[f.severity] != null) counts[f.severity] += 1;
  }
  return counts;
}
