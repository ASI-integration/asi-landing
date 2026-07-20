import fs from 'fs';
import path from 'path';
import React from 'react';
import { renderToStaticMarkup } from 'react-dom/server';
import { describe, expect, it } from 'vitest';
import CabinetRuntimePage from '../page';

const repoRoot = path.join(__dirname, '../../../../..');

describe('/cabinet/runtime', () => {
  it('shows placeholder runtime status copy', () => {
    const html = renderToStaticMarkup(React.createElement(CabinetRuntimePage));

    expect(html).toContain('ASI Runtime');
    expect(html).toContain('Подключение Runtime ещё не настроено');
    expect(html).toContain('Нет соединения');
  });

  it('reuses dashboard cabinet auth and redirects unauthenticated users to connect', () => {
    const layoutSrc = fs.readFileSync(path.join(repoRoot, 'src/app/cabinet/layout.tsx'), 'utf8');
    const dashboardLayoutSrc = fs.readFileSync(path.join(repoRoot, 'src/app/dashboard/layout.tsx'), 'utf8');
    const authGuardSrc = fs.readFileSync(path.join(repoRoot, 'src/components/DashboardAuthGuard.tsx'), 'utf8');

    expect(layoutSrc).toContain("from '../dashboard/layout'");
    expect(dashboardLayoutSrc).toContain('DashboardAuthGuard');
    expect(authGuardSrc).toContain('/connect?redirect=');
  });
});
