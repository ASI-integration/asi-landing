/**
 * Page extraction helpers for Website Auditor v1.
 * Pure post-processing is unit-testable without Playwright.
 */

/**
 * Clean visible text for corpus / rule scanning.
 * Removes script/style leftovers and collapses whitespace.
 */
export function cleanVisibleText(raw) {
  return String(raw ?? '')
    .replace(/<script[\s\S]*?<\/script>/gi, ' ')
    .replace(/<style[\s\S]*?<\/style>/gi, ' ')
    .replace(/[\u00A0\t\r]+/g, ' ')
    .replace(/\n{3,}/g, '\n\n')
    .replace(/[ \t]{2,}/g, ' ')
    .trim();
}

/**
 * Build a stable corpus record from extracted page fields.
 */
export function toCorpusRecord(page) {
  return {
    url: page.finalUrl || page.requestedUrl,
    requestedUrl: page.requestedUrl,
    title: page.title || '',
    headings: {
      h1: page.h1Texts || [],
      h2: page.h2Texts || [],
    },
    cleanedVisibleText: cleanVisibleText(page.visibleText || ''),
    ctaLabels: [...(page.ctaLabels || [])].sort((a, b) => a.localeCompare(b, 'ru')),
    internalLinkDestinations: [...new Set(page.internalLinks || [])].sort(),
  };
}

/**
 * Browser-side extractor (stringified into page.evaluate).
 * Returns a plain JSON-serializable object.
 */
export function browserExtractSource() {
  return () => {
    const textOf = (el) => (el?.innerText || el?.textContent || '').replace(/\s+/g, ' ').trim();

    const isVisible = (el) => {
      if (!(el instanceof Element)) return false;
      const style = window.getComputedStyle(el);
      if (style.display === 'none' || style.visibility === 'hidden' || style.opacity === '0') return false;
      const rect = el.getBoundingClientRect();
      return rect.width > 0 && rect.height > 0;
    };

    const h1Els = [...document.querySelectorAll('h1')].filter(isVisible);
    const h2Els = [...document.querySelectorAll('h2')].filter(isVisible);

    const anchors = [...document.querySelectorAll('a[href]')];
    const internalLinks = [];
    const hashLinks = [];
    const externalLinks = [];
    for (const a of anchors) {
      const href = a.getAttribute('href') || '';
      if (!href) continue;
      if (href.startsWith('#')) {
        hashLinks.push(href);
        continue;
      }
      try {
        const abs = new URL(href, window.location.href);
        if (abs.origin === window.location.origin) {
          internalLinks.push(abs.href);
          if (abs.hash) hashLinks.push(abs.hash);
        } else {
          externalLinks.push(abs.href);
        }
      } catch {
        // ignore malformed
      }
    }

    const ctaLabels = [];
    for (const el of document.querySelectorAll('a, button')) {
      if (!isVisible(el)) continue;
      const label = textOf(el);
      if (!label) continue;
      ctaLabels.push(label);
    }

    const forms = [...document.querySelectorAll('form')].map((form) => {
      const labels = [...form.querySelectorAll('label')]
        .map((l) => textOf(l))
        .filter(Boolean);
      const submit =
        textOf(form.querySelector('button[type="submit"], input[type="submit"]')) ||
        textOf(form.querySelector('button:not([type])'));
      const required = [...form.querySelectorAll('[required]')]
        .map((el) => el.getAttribute('name') || el.getAttribute('id') || el.tagName)
        .filter(Boolean);
      return {
        action: form.getAttribute('action') || '',
        method: (form.getAttribute('method') || 'get').toLowerCase(),
        labels,
        submitLabel: submit || '',
        requiredFields: required,
      };
    });

    const ids = [...document.querySelectorAll('[id]')]
      .map((el) => el.id)
      .filter(Boolean);

    const main = document.querySelector('main') || document.body;
    const visibleText = textOf(main);

    const canonical =
      document.querySelector('link[rel="canonical"]')?.getAttribute('href') || '';
    const metaDescription =
      document.querySelector('meta[name="description"]')?.getAttribute('content') || '';

    return {
      title: document.title || '',
      metaDescription,
      canonicalUrl: canonical,
      h1Count: h1Els.length,
      h1Texts: h1Els.map(textOf),
      h2Texts: h2Els.map(textOf),
      visibleText,
      ctaLabels: [...new Set(ctaLabels)],
      internalLinks: [...new Set(internalLinks)],
      hashLinks: [...new Set(hashLinks)],
      externalLinks: [...new Set(externalLinks)],
      forms,
      elementIds: [...new Set(ids)],
    };
  };
}
