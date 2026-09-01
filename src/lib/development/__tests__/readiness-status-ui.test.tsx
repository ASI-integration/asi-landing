import React from 'react';
import { readFileSync } from 'node:fs';
import { resolve } from 'node:path';
import { renderToStaticMarkup } from 'react-dom/server';
import { describe, expect, it } from 'vitest';
import type { DevelopmentReadinessState } from '@/lib/development/readiness-types';
import {
  ItemReadinessBadge,
  OVERALL_READINESS_STATUS_LABELS,
  OverallReadinessBadge,
  READINESS_STATE_LABELS,
  ReadinessRefreshIndicator,
  ReadinessStateIcon,
  overallReadinessAriaLabel,
  readinessItemAriaLabel,
  readinessStateColorClass,
} from '@/lib/development/readiness-status-ui';

const STATES: DevelopmentReadinessState[] = ['ready', 'degraded', 'blocked'];

describe('readiness status visual mapping', () => {
  it.each(STATES)('maps %s item badge from live state only', (state) => {
    const html = renderToStaticMarkup(React.createElement(ItemReadinessBadge, { state }));

    expect(html).toContain(`data-readiness-item="${state}"`);
    expect(html).toContain(READINESS_STATE_LABELS[state]);
    expect(html).toContain(`aria-label="${readinessItemAriaLabel(state)}"`);
    expect(html).toContain(readinessStateColorClass(state));
    expect(html).toContain('role="status"');
  });

  it.each(STATES)('maps %s overall badge from live overallState only', (state) => {
    const html = renderToStaticMarkup(React.createElement(OverallReadinessBadge, { state }));

    expect(html).toContain(`data-readiness-overall="${state}"`);
    expect(html).toContain(OVERALL_READINESS_STATUS_LABELS[state]);
    expect(html).toContain(`aria-label="${overallReadinessAriaLabel(state)}"`);
    expect(html).toContain(readinessStateColorClass(state));
    expect(html).toContain('role="status"');
  });

  it('uses distinct icons for ready, degraded and blocked', () => {
    const icons = Object.fromEntries(
      STATES.map((state) => [
        state,
        renderToStaticMarkup(React.createElement(ReadinessStateIcon, { state })),
      ]),
    ) as Record<DevelopmentReadinessState, string>;

    expect(icons.ready).not.toEqual(icons.degraded);
    expect(icons.ready).not.toEqual(icons.blocked);
    expect(icons.degraded).not.toEqual(icons.blocked);
    expect(OVERALL_READINESS_STATUS_LABELS.ready).toBe('ГОТОВО');
    expect(OVERALL_READINESS_STATUS_LABELS.degraded).toBe('ВНИМАНИЕ');
    expect(OVERALL_READINESS_STATUS_LABELS.blocked).toBe('СТОП');
  });

  it('announces each badge through a single accessible name', () => {
    for (const state of STATES) {
      const overall = renderToStaticMarkup(React.createElement(OverallReadinessBadge, { state }));
      const item = renderToStaticMarkup(React.createElement(ItemReadinessBadge, { state }));

      expect(overall.match(/aria-label="/g)).toHaveLength(1);
      expect(item.match(/aria-label="/g)).toHaveLength(1);
      expect(overall).toContain('aria-hidden="true"');
      expect(item).toContain('aria-hidden="true"');
      expect(overall).not.toContain('role="img"');
      expect(item).not.toContain('role="img"');
    }
  });

  it('uses accessible contrast classes for ready, degraded and blocked text', () => {
    expect(readinessStateColorClass('ready')).toBe('text-emerald-700');
    expect(readinessStateColorClass('degraded')).toBe('text-amber-700');
    expect(readinessStateColorClass('blocked')).toBe('text-red-700');
  });

  it('exposes a polite refresh indicator without replacing prior content consumers', () => {
    const html = renderToStaticMarkup(React.createElement(ReadinessRefreshIndicator));

    expect(html).toContain('data-readiness-refresh="true"');
    expect(html).toContain('aria-label="Идёт повторная проверка готовности"');
    expect(html).toContain('Обновление…');
    expect(html).toContain('role="status"');
  });

  it('collects all development readiness Playwright titles via project grep', () => {
    const config = readFileSync(resolve(process.cwd(), 'playwright.dashboard.config.ts'), 'utf8');
    const grepMatch = config.match(/name:\s*'development-readiness'[\s\S]*?grep:\s*\/([^/\n]+)\//);
    expect(grepMatch?.[1]).toBe('development readiness');

    const grep = new RegExp(grepMatch![1]);
    const titles = [
      'development readiness panel fails closed while loading or errored and preserves non-blocking states',
      'development readiness status icons follow live ready, degraded and blocked states',
      'development readiness keeps the previous snapshot visible during a delayed refresh and fails closed on refresh error',
    ];

    for (const title of titles) {
      expect(grep.test(title)).toBe(true);
    }
  });
});
