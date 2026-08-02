import React from 'react';
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
    expect(html).toContain('role="img"');
  });

  it.each(STATES)('maps %s overall badge from live overallState only', (state) => {
    const html = renderToStaticMarkup(React.createElement(OverallReadinessBadge, { state }));

    expect(html).toContain(`data-readiness-overall="${state}"`);
    expect(html).toContain(OVERALL_READINESS_STATUS_LABELS[state]);
    expect(html).toContain(`aria-label="${overallReadinessAriaLabel(state)}"`);
    expect(html).toContain(readinessStateColorClass(state));
  });

  it('uses distinct icons for ready, degraded and blocked', () => {
    const icons = Object.fromEntries(
      STATES.map((state) => [
        state,
        renderToStaticMarkup(
          React.createElement(ReadinessStateIcon, {
            state,
            ariaLabel: readinessItemAriaLabel(state),
          }),
        ),
      ]),
    ) as Record<DevelopmentReadinessState, string>;

    expect(icons.ready).not.toEqual(icons.degraded);
    expect(icons.ready).not.toEqual(icons.blocked);
    expect(icons.degraded).not.toEqual(icons.blocked);
    expect(OVERALL_READINESS_STATUS_LABELS.ready).toBe('Система готова');
  });

  it('exposes a polite refresh indicator without replacing prior content consumers', () => {
    const html = renderToStaticMarkup(React.createElement(ReadinessRefreshIndicator));

    expect(html).toContain('data-readiness-refresh="true"');
    expect(html).toContain('aria-label="Идёт повторная проверка готовности"');
    expect(html).toContain('Обновление…');
    expect(html).toContain('role="status"');
  });
});
