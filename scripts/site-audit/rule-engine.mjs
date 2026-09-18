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
import { cleanVisibleText } from './page-extractor.mjs';

/**
 * @typedef {'critical'|'major'|'minor'|'info'} Severity
 * @typedef {{
 *   id: string,
 *   severity: Severity,
 *   url: string,
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

/** Commercial contradiction detectors across a page's visible text. */
export function detectCommercialConflicts(text, url) {
  /** @type {Finding[]} */
  const out = [];
  const t = text;
  const contract = RU_PUBLIC_SITE_CONTRACT.pricing;

  // Paid pilot — tight phrases only (avoid nav "Пилот" + unrelated "оплата")
  if (
    /платн[а-яё]*\s+пилот/i.test(t) ||
    /пилот[а-яё]*\s*[—\-–]?\s*платн/i.test(t) ||
    /стоимость\s+пилот/i.test(t) ||
    /оплата\s+пилот/i.test(t) ||
    /пилот[^\n.]{0,25}стоит/i.test(t)
  ) {
    out.push(
      finding({
        id: 'COMMERCIAL_PAID_PILOT_CONFLICT',
        severity: 'critical',
        url,
        category: 'commercial-contract',
        title: 'Pilot described as paid',
        evidence: snippetAround(
          t,
          t.search(/платн[а-яё]*\s+пилот|пилот[а-яё]*\s*[—\-–]?\s*платн|стоимость\s+пилот|оплата\s+пилот/i),
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

  if (!page.title || !String(page.title).trim()) {
    out.push(
      finding({
        id: 'STRUCT_MISSING_TITLE',
        severity: 'major',
        url,
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

export function analyzeLinks(page, baseUrl, linkStatusMap) {
  /** @type {Finding[]} */
  const out = [];
  const url = page.finalUrl || page.requestedUrl;
  const ids = new Set(page.elementIds || []);

  for (const href of page.hashLinks || []) {
    const hash = href.includes('#') ? `#${href.split('#').pop()}` : href;
    if (!hashTargetExists(hash, ids)) {
      out.push(
        finding({
          id: 'LINK_MISSING_HASH_TARGET',
          severity: 'major',
          url,
          category: 'links',
          title: 'Hash link target ID does not exist',
          evidence: hash,
          explanation: `No element with id="${hash.slice(1)}" on the page.`,
          action: 'fix anchor target or remove link',
        }),
      );
    }
  }

  for (const href of [...(page.internalLinks || []), ...(page.externalLinks || [])]) {
    if (!String(href || '').trim()) continue;
    if (isGoogleSearchOrRedirect(href, baseUrl)) {
      out.push(
        finding({
          id: 'LINK_GOOGLE_SEARCH_URL',
          severity: 'critical',
          url,
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
      // Skip hash-only and protocol skips already filtered by extractor; flag only opaque garbage
      if (/^[a-z][a-z0-9+.-]*:/i.test(String(href)) === false && String(href).includes(' ')) {
        out.push(
          finding({
            id: 'LINK_MALFORMED_HREF',
            severity: 'major',
            url,
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

  for (const [linkUrl, status] of Object.entries(linkStatusMap || {})) {
    const fail = classifyLinkFailure(status);
    if (!fail) continue;
    out.push(
      finding({
        id: status >= 500 ? 'LINK_INTERNAL_5XX' : status == null ? 'LINK_NAV_FAILURE' : 'LINK_INTERNAL_4XX',
        severity: fail.severity,
        url: linkUrl,
        category: 'links',
        title: fail.title,
        evidence: `status=${status}`,
        explanation: 'Internal GET navigation did not succeed.',
        action: 'fix route or remove dead link',
      }),
    );
  }

  return out;
}

export function analyzeDuplicateTitles(pages) {
  /** @type {Finding[]} */
  const out = [];
  /** @type {Map<string, string[]>} */
  const byTitle = new Map();
  for (const page of pages) {
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
 * Run all rules against crawl results.
 * @param {{ pages: object[], baseUrl: string, linkStatusMap?: Record<string, number|null> }} input
 */
export function runRuleEngine(input) {
  const pages = [...(input.pages || [])].sort((a, b) =>
    String(a.finalUrl || a.requestedUrl).localeCompare(String(b.finalUrl || b.requestedUrl)),
  );
  /** @type {Finding[]} */
  const findings = [];

  for (const page of pages) {
    const url = page.finalUrl || page.requestedUrl;
    const text = pageText(page);
    findings.push(...analyzePageStructure(page));
    findings.push(...analyzeLinks(page, input.baseUrl, {}));
    findings.push(...detectCommercialConflicts(text, url));
    findings.push(...detectPatternFindings(text, url, UNSUPPORTED_CLAIM_PATTERNS, 'unsupported-claim'));
    findings.push(...detectPatternFindings(text, url, OBSOLETE_JARGON_PATTERNS, 'jargon'));
    findings.push(...detectPatternFindings(text, url, SENSITIVE_PATTERNS, 'sensitive'));

    if (page.navigationError) {
      findings.push(
        finding({
          id: 'LINK_NAV_FAILURE',
          severity: 'critical',
          url,
          category: 'links',
          title: 'Navigation failure',
          evidence: String(page.navigationError),
          explanation: 'Page navigation failed.',
          action: 'investigate route',
        }),
      );
    }
    if (page.status && page.status >= 400) {
      const fail = classifyLinkFailure(page.status);
      if (fail) {
        findings.push(
          finding({
            id: page.status >= 500 ? 'LINK_INTERNAL_5XX' : 'LINK_INTERNAL_4XX',
            severity: fail.severity,
            url,
            category: 'links',
            title: fail.title,
            evidence: `status=${page.status}`,
            explanation: 'Crawled page returned an error status.',
            action: 'fix route',
          }),
        );
      }
    }
  }

  findings.push(...analyzeLinks({ finalUrl: input.baseUrl, hashLinks: [], internalLinks: [], externalLinks: [], elementIds: [] }, input.baseUrl, input.linkStatusMap || {}));
  findings.push(...analyzeDuplicateTitles(pages));
  findings.push(...analyzeNearDuplicateUrls(pages, input.baseUrl));

  // Homepage form informational check (disabled by default)
  if (RU_PUBLIC_SITE_CONTRACT.homepageForm.enabled) {
    // reserved for v1.1 enablement
  } else {
    findings.push(
      finding({
        id: 'FORM_HOMEPAGE_CONTRACT_INFO',
        severity: 'info',
        url: RU_PUBLIC_SITE_CONTRACT.homepageForm.path,
        category: 'forms',
        title: 'Homepage form contract checks are informational until enabled',
        evidence: 'homepageForm.enabled=false',
        explanation:
          'Expected post-#308 acquisition form fields are configured but not hard-failing live production yet.',
        action: 'enable homepageForm checks after production deploy of one-page flow',
      }),
    );
  }

  // Deduplicate identical findings (same id+url+evidence)
  const seen = new Set();
  const deduped = [];
  for (const f of findings) {
    const key = `${f.id}|${f.url}|${f.evidence}`;
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
    return a.url.localeCompare(b.url);
  });
}

export function countBySeverity(findings) {
  const counts = { critical: 0, major: 0, minor: 0, info: 0 };
  for (const f of findings) {
    if (counts[f.severity] != null) counts[f.severity] += 1;
  }
  return counts;
}
