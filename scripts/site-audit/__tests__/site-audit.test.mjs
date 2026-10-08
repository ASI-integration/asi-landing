import assert from 'node:assert/strict';
import test from 'node:test';
import {
  normalizeUrl,
  shouldCrawlHref,
  isSameOrigin,
  hashTargetExists,
  classifyLinkFailure,
  isGoogleSearchOrRedirect,
} from '../url-policy.mjs';
import {
  detectCommercialConflicts,
  detectPatternFindings,
  runRuleEngine,
  sortFindings,
  analyzeHashLinks,
  analyzePageStructure,
  analyzeLinkStatuses,
  analyzeHomepageFormContract,
  findHomepagePage,
  resolveHomepageContractMode,
} from '../rule-engine.mjs';
import {
  UNSUPPORTED_CLAIM_PATTERNS,
  OBSOLETE_JARGON_PATTERNS,
  SENSITIVE_PATTERNS,
  maskSensitive,
} from '../contracts/ru-public-site.mjs';
import { cleanVisibleText, toCorpusRecord, buildHashRef } from '../page-extractor.mjs';
import { isHtmlContentType } from '../content-type.mjs';
import { resolveExitCode } from '../report.mjs';
import { productionShaInAllowlist, probeProductionVersion } from '../version-probe.mjs';

const BASE = 'https://asi-global.ru/ru';
const HOME = 'https://asi-global.ru/ru';
const OTHER = 'https://asi-global.ru/ru/early-access';

function htmlPage(partial) {
  return {
    status: 200,
    isHtmlDocument: true,
    contentType: 'text/html',
    title: 'ASI',
    metaDescription: 'desc',
    h1Count: 1,
    h1Texts: ['H1'],
    h2Texts: [],
    visibleText: 'ok',
    ctaLabels: ['Go'],
    internalLinks: [],
    hashRefs: [],
    externalLinks: [],
    elementIds: [],
    forms: [],
    ...partial,
  };
}

test('normalizeUrl strips hash and trailing slash', () => {
  assert.equal(
    normalizeUrl('https://asi-global.ru/ru/offer/#section', BASE),
    'https://asi-global.ru/ru/offer',
  );
  assert.equal(normalizeUrl('https://asi-global.ru/ru/', BASE), 'https://asi-global.ru/ru');
});

test('same-origin policy and skip list', () => {
  assert.equal(isSameOrigin('/ru/privacy', BASE), true);
  assert.equal(shouldCrawlHref('mailto:support@asi-global.ru', BASE).crawl, false);
  assert.equal(shouldCrawlHref('https://t.me/ASI_Support_Bot', BASE).crawl, false);
  assert.equal(shouldCrawlHref('/api/early-access/objects', BASE).crawl, false);
  assert.equal(shouldCrawlHref('/dashboard/settings', BASE).crawl, false);
  assert.equal(shouldCrawlHref('/ru/offer', BASE).crawl, true);
  assert.equal(shouldCrawlHref('#pilot-form', BASE).crawl, false);
});

test('fragment target validation helper', () => {
  assert.equal(hashTargetExists('#pilot-form', ['pilot-form', 'pricing']), true);
  assert.equal(hashTargetExists('#missing', ['pilot-form']), false);
});

test('broken-link classification', () => {
  assert.equal(classifyLinkFailure(404)?.severity, 'critical');
  assert.equal(classifyLinkFailure(500)?.severity, 'critical');
  assert.equal(classifyLinkFailure(200), null);
  assert.equal(classifyLinkFailure(null)?.severity, 'critical');
});

test('google search URLs flagged', () => {
  assert.equal(isGoogleSearchOrRedirect('https://www.google.com/search?q=asi', BASE), true);
});

test('commercial contract: correct 0/14/1000 flow passes', () => {
  const text =
    'Подключение и настройка — 0 ₽. 14 дней работы на объекте — 0 ₽. После пилота — 1000 ₽ / объект в месяц. Никаких автоматических продлений.';
  const findings = detectCommercialConflicts(text, '/ru');
  assert.equal(findings.length, 0);
});

test('commercial contract: free pilot wording does not trigger paid-pilot conflict', () => {
  const findings = detectCommercialConflicts('Бесплатный пилот длится 14 дней. Оценка локации не входит в бесплатный пилот.', '/ru/x');
  assert.ok(!findings.some((f) => f.id === 'COMMERCIAL_PAID_PILOT_CONFLICT'));
});

test('commercial contract: paid pilot conflict fails', () => {
  const findings = detectCommercialConflicts('Платный пилот доступен сразу после заявки.', '/ru/x');
  assert.ok(findings.some((f) => f.id === 'COMMERCIAL_PAID_PILOT_CONFLICT'));
});

test('commercial contract: wrong monthly price fails', () => {
  const findings = detectCommercialConflicts('После пилота — 2500 ₽ / объект в месяц.', '/ru/x');
  assert.ok(findings.some((f) => f.id === 'COMMERCIAL_CONTINUATION_PRICE_CONFLICT'));
});

test('commercial contract: auto-renewal claim fails', () => {
  const findings = detectCommercialConflicts(
    'После пилота подписка автоматически продлевается.',
    '/ru/x',
  );
  assert.ok(findings.some((f) => f.id === 'COMMERCIAL_AUTO_PAID_TRANSITION'));
});

test('unsupported claim patterns', () => {
  const findings = detectPatternFindings(
    'ASI обеспечивает полную автоматизацию без человека.',
    '/ru',
    UNSUPPORTED_CLAIM_PATTERNS,
    'unsupported-claim',
  );
  assert.ok(findings.some((f) => f.id === 'CLAIM_FULL_AUTOMATION'));
  assert.ok(findings.some((f) => f.id === 'CLAIM_WITHOUT_HUMAN'));
  assert.ok(findings.every((f) => f.explanation.includes('requires runtime confirmation')));
});

test('jargon/obsolete phrase detection', () => {
  const findings = detectPatternFindings(
    'Мы строим операционный слой поверх менеджера каналов.',
    '/ru',
    OBSOLETE_JARGON_PATTERNS,
    'jargon',
  );
  assert.ok(findings.some((f) => f.id === 'JARGON_OPERATIONAL_LAYER'));
});

test('sensitive value masking', () => {
  assert.equal(maskSensitive('SecretPass99'), 'Se…99');
  const findings = detectPatternFindings(
    'Wi-Fi пароль: SuperSecret99',
    '/ru',
    SENSITIVE_PATTERNS,
    'sensitive',
  );
  assert.ok(findings.some((f) => f.id === 'SENSITIVE_WIFI_PASSWORD'));
  assert.ok(!findings[0].evidence.includes('SuperSecret99'));
  assert.match(findings[0].evidence, /…/);
});

test('deterministic ordering of findings', () => {
  const unsorted = [
    { id: 'B', severity: 'minor', url: '/b', category: 'x', title: '', evidence: '', explanation: '', action: '' },
    { id: 'A', severity: 'critical', url: '/a', category: 'x', title: '', evidence: '', explanation: '', action: '' },
    { id: 'A', severity: 'critical', url: '/z', category: 'x', title: '', evidence: '', explanation: '', action: '' },
  ];
  const sorted = sortFindings(unsorted);
  assert.deepEqual(
    sorted.map((f) => `${f.severity}:${f.id}:${f.url}`),
    ['critical:A:/a', 'critical:A:/z', 'minor:B:/b'],
  );
});

test('same-page valid hash passes; missing hash fails', () => {
  const page = htmlPage({
    requestedUrl: HOME,
    finalUrl: HOME,
    elementIds: ['pricing'],
    hashRefs: [buildHashRef('#pricing', HOME), buildHashRef('#missing', HOME)],
  });
  const findings = analyzeHashLinks([page], BASE);
  assert.equal(findings.some((f) => f.id === 'LINK_MISSING_HASH_TARGET' && f.evidence.includes('#pricing')), false);
  assert.ok(findings.some((f) => f.id === 'LINK_MISSING_HASH_TARGET' && f.evidence.includes('#missing')));
});

test('cross-page hash validates target page, not source', () => {
  const source = htmlPage({
    requestedUrl: OTHER,
    finalUrl: OTHER,
    elementIds: ['unrelated-only'],
    hashRefs: [
      buildHashRef(`${HOME}#location-check`, OTHER),
      buildHashRef(`${HOME}#does-not-exist`, OTHER),
    ],
  });
  const target = htmlPage({
    requestedUrl: HOME,
    finalUrl: HOME,
    elementIds: ['location-check'],
  });
  const findings = analyzeHashLinks([source, target], BASE);
  assert.equal(
    findings.some((f) => f.id === 'LINK_MISSING_HASH_TARGET' && f.evidence.includes('#location-check')),
    false,
    'must not fail valid cross-page hash against source ids',
  );
  const missing = findings.find(
    (f) => f.id === 'LINK_MISSING_HASH_TARGET' && f.evidence.includes('#does-not-exist'),
  );
  assert.ok(missing);
  assert.equal(missing.sourcePage, OTHER);
  assert.equal(missing.targetUrl, HOME);
});

test('unavailable hash target does not emit MAJOR missing-target', () => {
  const source = htmlPage({
    requestedUrl: OTHER,
    finalUrl: OTHER,
    elementIds: [],
    hashRefs: [buildHashRef(`${HOME}#pricing`, OTHER)],
  });
  const findings = analyzeHashLinks([source], BASE);
  assert.equal(findings.some((f) => f.id === 'LINK_MISSING_HASH_TARGET'), false);
  assert.ok(findings.some((f) => f.id === 'LINK_HASH_TARGET_UNVERIFIED' && f.severity === 'info'));
});

test('non-HTML responses skip structure rules but keep 5xx', () => {
  const pdf = {
    requestedUrl: 'https://asi-global.ru/ru/location-report/sample/pdf',
    finalUrl: 'https://asi-global.ru/ru/location-report/sample/pdf',
    status: 502,
    isHtmlDocument: false,
    contentType: 'application/pdf',
    title: '',
    metaDescription: '',
    h1Count: 0,
    h1Texts: [],
    h2Texts: [],
    visibleText: '',
    ctaLabels: [],
    internalLinks: [],
    hashRefs: [],
    externalLinks: [],
    elementIds: [],
    forms: [],
  };
  assert.equal(analyzePageStructure(pdf).length, 0);
  assert.equal(isHtmlContentType('application/pdf'), false);
  assert.equal(isHtmlContentType('text/html; charset=utf-8'), true);

  const findings = runRuleEngine({
    pages: [pdf],
    baseUrl: BASE,
    linkStatusMap: { [pdf.requestedUrl]: 502 },
    linkReferrers: {
      [pdf.requestedUrl]: [HOME],
    },
    homepageContractMode: 'disabled',
    productionVersion: 'unknown',
  });
  assert.ok(findings.some((f) => f.id === 'LINK_INTERNAL_5XX'));
  assert.equal(findings.some((f) => f.id === 'STRUCT_MISSING_H1'), false);
  assert.equal(findings.some((f) => f.id === 'STRUCT_MISSING_TITLE'), false);
  assert.equal(findings.some((f) => f.id === 'STRUCT_MISSING_META_DESCRIPTION'), false);
  const five = findings.find((f) => f.id === 'LINK_INTERNAL_5XX');
  assert.match(five.evidence, /SOURCE:/);
  assert.match(five.evidence, /TARGET:/);
  assert.equal(five.sourcePage, HOME);
  assert.equal(five.targetUrl, pdf.requestedUrl);
});

test('link status provenance lists sorted referrers', () => {
  const target = 'https://asi-global.ru/ru/broken';
  const findings = analyzeLinkStatuses(
    [
      htmlPage({
        requestedUrl: target,
        finalUrl: target,
        status: 502,
        title: '',
        metaDescription: '',
        h1Count: 0,
        h1Texts: [],
        isHtmlDocument: true,
      }),
    ],
    { [target]: 502 },
    {
      [target]: ['https://asi-global.ru/ru/z', 'https://asi-global.ru/ru/a'],
    },
    BASE,
  );
  const f = findings.find((x) => x.id === 'LINK_INTERNAL_5XX');
  assert.ok(f);
  assert.match(f.evidence, /SOURCE: https:\/\/asi-global\.ru\/ru\/a, https:\/\/asi-global\.ru\/ru\/z/);
});

test('homepage contract auto mode is SHA-allowlist exact match only', () => {
  const known = 'fb7d6f8e79b2ce99b35164b3dc0f4acfc7e62874';
  const live = 'c3c12b7f8ab1c3740b8287e4d8480c52169418a0';
  assert.equal(resolveHomepageContractMode('disabled', known).enforce, false);
  assert.equal(resolveHomepageContractMode('enabled', 'unknown').enforce, true);
  assert.equal(resolveHomepageContractMode('auto', known).enforce, true);
  assert.equal(resolveHomepageContractMode('auto', live).enforce, true);
  assert.equal(resolveHomepageContractMode('auto', '53461e999ad115cf9c5dd43a93a9c13bb14e6c6d').enforce, false);
  assert.equal(resolveHomepageContractMode('auto', 'unknown').enforce, false);
  // Lexicographically "greater" SHA must not enable without exact allowlist membership.
  assert.equal(productionShaInAllowlist('zzzzzzzzzzzzzzzzzzzzzzzzzzzzzzzzzzzzzzzz', [known, live]), false);
  assert.equal(productionShaInAllowlist(live, [known, live]), true);
});

test('redirected /ru homepage is selected over /ru/contacts', () => {
  const home = htmlPage({
    requestedUrl: 'https://asi-global.ru/ru',
    finalUrl: 'https://asi-global.ru/',
    forms: [
      {
        labels: ['Ваше имя', 'Телефон или Telegram', 'Количество объектов в управлении'],
        submitLabel: 'Подключить объект бесплатно',
      },
    ],
    visibleText: 'Ваше имя Телефон или Telegram Количество объектов Подключить объект бесплатно',
  });
  const contacts = htmlPage({
    requestedUrl: 'https://asi-global.ru/ru/contacts',
    finalUrl: 'https://asi-global.ru/ru/contacts',
    forms: [],
    visibleText: 'Контакты',
  });
  const selected = findHomepagePage([contacts, home], BASE);
  assert.equal(selected?.requestedUrl, 'https://asi-global.ru/ru');
  assert.equal(selected?.finalUrl, 'https://asi-global.ru/');

  const findings = analyzeHomepageFormContract([contacts, home], BASE, {
    mode: 'enabled',
    productionVersion: 'c3c12b7f8ab1c3740b8287e4d8480c52169418a0',
  });
  assert.equal(findings.some((f) => f.id.startsWith('FORM_HOMEPAGE')), false);
  assert.equal(findings.some((f) => String(f.sourcePage || '').includes('/contacts')), false);
});

test('redirected /ru missing field reports homepage identity, not contacts', () => {
  const home = htmlPage({
    requestedUrl: 'https://asi-global.ru/ru',
    finalUrl: 'https://asi-global.ru/',
    forms: [{ labels: ['Телефон или Telegram', 'Количество объектов'], submitLabel: 'Go' }],
    visibleText: 'Телефон или Telegram Количество объектов',
  });
  const contacts = htmlPage({
    requestedUrl: 'https://asi-global.ru/ru/contacts',
    finalUrl: 'https://asi-global.ru/ru/contacts',
    forms: [],
    visibleText: 'Контакты',
  });
  const findings = analyzeHomepageFormContract([contacts, home], BASE, {
    mode: 'enabled',
    productionVersion: 'unknown',
  });
  const missing = findings.filter((f) => f.id === 'FORM_HOMEPAGE_FIELD_MISSING');
  assert.ok(missing.length >= 1);
  assert.ok(missing.every((f) => f.sourcePage === 'https://asi-global.ru/ru'));
  assert.ok(missing.every((f) => !String(f.sourcePage).includes('contacts')));
  assert.ok(missing.some((f) => f.evidence.includes('Ваше имя') && f.evidence.includes('requested:')));
  assert.ok(missing.some((f) => f.evidence.includes('final: https://asi-global.ru/')));
});

test('missing exact homepage identity emits FORM_HOMEPAGE_MISSING', () => {
  const contacts = htmlPage({
    requestedUrl: 'https://asi-global.ru/ru/contacts',
    finalUrl: 'https://asi-global.ru/ru/contacts',
    forms: [
      {
        labels: ['Ваше имя', 'Телефон или Telegram', 'Количество объектов'],
        submitLabel: 'Подключить объект бесплатно',
      },
    ],
    visibleText: 'Ваше имя',
  });
  const findings = analyzeHomepageFormContract([contacts], BASE, {
    mode: 'enabled',
    productionVersion: 'c3c12b7f8ab1c3740b8287e4d8480c52169418a0',
  });
  assert.ok(findings.some((f) => f.id === 'FORM_HOMEPAGE_MISSING'));
  assert.equal(findings.some((f) => f.id === 'FORM_HOMEPAGE_FIELD_MISSING'), false);
});

test('version probe records unknown without failing', async () => {
  const result = await probeProductionVersion(BASE, {
    fetchImpl: async () => {
      throw new Error('network down');
    },
  });
  assert.equal(result.productionVersion, 'unknown');
  assert.equal(result.versionProbeOk, false);
  assert.match(result.versionProbeUrl, /\/api\/version$/);

  const ok = await probeProductionVersion(BASE, {
    fetchImpl: async () => ({
      ok: true,
      status: 200,
      json: async () => ({ sha: 'abc123' }),
    }),
  });
  assert.equal(ok.productionVersion, 'abc123');
  assert.equal(ok.deployedSha, 'abc123');
});

test('corpus extraction cleans scripts/styles leftovers', () => {
  const cleaned = cleanVisibleText('Hello <script>alert(1)</script> world <style>.x{}</style> end');
  assert.equal(cleaned.includes('script'), false);
  assert.equal(cleaned.includes('style'), false);
  assert.match(cleaned, /Hello/);
  const record = toCorpusRecord({
    requestedUrl: 'https://asi-global.ru/ru',
    finalUrl: 'https://asi-global.ru/ru',
    title: 'ASI',
    h1Texts: ['H1'],
    h2Texts: ['H2'],
    visibleText: 'Visible',
    ctaLabels: ['B', 'A'],
    internalLinks: ['https://asi-global.ru/ru/b', 'https://asi-global.ru/ru/a'],
  });
  assert.deepEqual(record.ctaLabels, ['A', 'B']);
  assert.deepEqual(record.internalLinkDestinations, [
    'https://asi-global.ru/ru/a',
    'https://asi-global.ru/ru/b',
  ]);
});

test('exit codes honor fail-on policy', () => {
  assert.equal(resolveExitCode({ critical: 0, major: 2, minor: 1, info: 0 }, 'critical'), 0);
  assert.equal(resolveExitCode({ critical: 1, major: 0, minor: 0, info: 0 }, 'critical'), 2);
  assert.equal(resolveExitCode({ critical: 0, major: 1, minor: 0, info: 0 }, 'major'), 2);
  assert.equal(resolveExitCode({ critical: 5, major: 5, minor: 5, info: 5 }, 'none'), 0);
});

test('runRuleEngine is deterministic for identical pages', () => {
  const page = htmlPage({
    requestedUrl: 'https://asi-global.ru/ru',
    finalUrl: 'https://asi-global.ru/ru',
    visibleText:
      'Подключение и настройка — 0 ₽. 14 дней работы — 0 ₽. После пилота — 1000 ₽ / объект в месяц.',
    ctaLabels: ['Подключить объект бесплатно'],
  });
  const a = runRuleEngine({
    pages: [page],
    baseUrl: BASE,
    linkStatusMap: {},
    homepageContractMode: 'disabled',
    productionVersion: 'unknown',
  });
  const b = runRuleEngine({
    pages: [page],
    baseUrl: BASE,
    linkStatusMap: {},
    homepageContractMode: 'disabled',
    productionVersion: 'unknown',
  });
  assert.deepEqual(
    a.map((f) => `${f.id}|${f.severity}|${f.url}|${f.targetUrl || ''}`),
    b.map((f) => `${f.id}|${f.severity}|${f.url}|${f.targetUrl || ''}`),
  );
});
