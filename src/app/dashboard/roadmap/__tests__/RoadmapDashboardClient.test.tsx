import React from 'react';
import { readFileSync } from 'node:fs';
import { resolve } from 'node:path';
import { renderToStaticMarkup } from 'react-dom/server';
import { describe, expect, it } from 'vitest';
import RoadmapDashboardClient from '@/app/dashboard/roadmap/RoadmapDashboardClient';
import { ASI_PRODUCT_ROADMAP } from '@/lib/roadmap/asi-product-roadmap';
import { ROADMAP_STATUS_LABELS } from '@/lib/roadmap/status-ui';
import type { RoadmapStatus } from '@/lib/roadmap/types';

const STATUSES: RoadmapStatus[] = ['done', 'in_progress', 'blocked', 'later'];

describe('RoadmapDashboardClient UI', () => {
  it('renders all status labels, summary counts, focus and filters', () => {
    const html = renderToStaticMarkup(React.createElement(RoadmapDashboardClient));

    expect(html).toContain('data-roadmap-dashboard="true"');
    expect(html).toContain('План ASI');
    expect(html).toContain('Ближайший фокус');
    expect(html).toContain('data-roadmap-summary="true"');
    expect(html).toContain('data-roadmap-progress-strip="true"');
    expect(html).toContain('data-roadmap-filters="true"');

    for (const status of STATUSES) {
      expect(html).toContain(`data-roadmap-status="${status}"`);
      expect(html).toContain(`data-roadmap-count="${status}"`);
      expect(html).toContain(`data-roadmap-filter="${status}"`);
      expect(html).toContain(ROADMAP_STATUS_LABELS[status]);
    }
    expect(html).toContain('data-roadmap-filter="all"');
  });

  it('renders departments and allows department expansion markup', () => {
    const html = renderToStaticMarkup(React.createElement(RoadmapDashboardClient));
    const clientSrc = readFileSync(
      resolve(process.cwd(), 'src/app/dashboard/roadmap/RoadmapDashboardClient.tsx'),
      'utf8',
    );

    for (const department of ASI_PRODUCT_ROADMAP) {
      expect(html).toContain(`data-roadmap-department="${department.id}"`);
      expect(html).toContain(department.title);
    }

    expect(clientSrc).toContain('data-roadmap-department-toggle');
    expect(clientSrc).toContain('data-roadmap-department-body');
    expect(clientSrc).toContain('aria-expanded={open}');
    expect(html).toContain('data-roadmap-department-body=');
  });

  it('keeps dashboard links and mobile-safe overflow classes', () => {
    const html = renderToStaticMarkup(React.createElement(RoadmapDashboardClient));
    const clientSrc = readFileSync(
      resolve(process.cwd(), 'src/app/dashboard/roadmap/RoadmapDashboardClient.tsx'),
      'utf8',
    );

    expect(clientSrc).toContain('overflow-x-hidden');
    expect(clientSrc).toContain('max-w-5xl');
    expect(clientSrc).toMatch(/flex-col[\s\S]*sm:flex-row/);
    expect(html).not.toMatch(/min-w-\[\d{4,}px\]/);
    expect(html).toContain('data-roadmap-dashboard-link="/dashboard/');
  });

  it('hides technical evidence behind Подробнее by default', () => {
    const html = renderToStaticMarkup(React.createElement(RoadmapDashboardClient));
    expect(html).toContain('Подробнее');
    expect(html).not.toContain('data-roadmap-evidence=');
  });
});

describe('roadmap page owner guard', () => {
  it('wraps the page with DevelopmentOwnerGuard like development console', () => {
    const pageSrc = readFileSync(
      resolve(process.cwd(), 'src/app/dashboard/roadmap/page.tsx'),
      'utf8',
    );
    expect(pageSrc).toContain('DevelopmentOwnerGuard');
    expect(pageSrc).toContain('RoadmapDashboardClient');
  });
});
