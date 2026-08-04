import fs from 'fs';
import path from 'path';
import { describe, expect, it } from 'vitest';

const layoutSrc = fs.readFileSync(
  path.join(__dirname, '../layout.tsx'),
  'utf8',
);

describe('dashboard sidebar scroll layout', () => {
  it('keeps the sidebar viewport-bound with a fixed logo and independently scrollable nav', () => {
    expect(layoutSrc).toMatch(/fixed left-0 top-0 bottom-0/);
    expect(layoutSrc).toMatch(/\bh-dvh\b/);
    expect(layoutSrc).toMatch(/\bmax-h-dvh\b/);
    expect(layoutSrc).toMatch(/flex flex-col/);
    expect(layoutSrc).toMatch(/fixed inset-0 z-20 h-dvh w-full overflow-hidden bg-slate-50/);
    expect(layoutSrc).toMatch(/flex h-full min-h-0 flex-col overflow-hidden md:pl-60/);

    const logoMatch = layoutSrc.match(
      /<Link[\s\S]*?>\s*ASI\s*<\/Link>/,
    );
    expect(logoMatch?.[0]).toMatch(/\bshrink-0\b/);
    expect(logoMatch?.[0]).not.toMatch(/overflow-y-auto/);

    const navMatch = layoutSrc.match(/<nav className="([^"]+)"/);
    expect(navMatch?.[1]).toMatch(/\bmin-h-0\b/);
    expect(navMatch?.[1]).toMatch(/\bflex-1\b/);
    expect(navMatch?.[1]).toMatch(/\boverflow-y-auto\b/);
    expect(navMatch?.[1]).toMatch(/\boverflow-x-hidden\b/);
    expect(navMatch?.[1]).toMatch(/\btouch-pan-y\b/);

    const mainMatch = layoutSrc.match(/<main className="([^"]+)"/);
    expect(mainMatch?.[1]).toMatch(/\bmin-h-0\b/);
    expect(mainMatch?.[1]).toMatch(/\bflex-1\b/);
    expect(mainMatch?.[1]).toMatch(/\boverflow-y-auto\b/);
    expect(mainMatch?.[1]).toMatch(/\boverflow-x-hidden\b/);
  });

  it('preserves overlay close, role filtering, routes, and active-state matching', () => {
    expect(layoutSrc).toContain('fixed inset-0 bg-black/50 z-40 md:hidden');
    expect(layoutSrc).toContain('onClick={onClose}');
    expect(layoutSrc).toContain('session?.isCrmOperator === true');
    expect(layoutSrc).toContain('session?.isDevelopmentOwner === true');
    expect(layoutSrc).toContain(
      "pathname === href || (href !== '/dashboard' && pathname.startsWith(href))",
    );
    expect(layoutSrc).toContain("{ href: '/dashboard', key: 'overview', label: 'Обзор' }");
    expect(layoutSrc).toContain("{ href: '/dashboard/settings', key: 'settings', label: 'Настройки' }");
  });

  it('exposes owner-only План ASI nav item immediately before Разработка ASI', () => {
    expect(layoutSrc).toContain("{ href: '/dashboard/roadmap', key: 'roadmap', label: 'План ASI' }");
    expect(layoutSrc).toContain(
      "{ href: '/dashboard/development', key: 'development', label: 'Разработка ASI' }",
    );
    expect(layoutSrc).toContain("item.key === 'development' || item.key === 'roadmap'");

    const roadmapIdx = layoutSrc.indexOf("key: 'roadmap'");
    const developmentIdx = layoutSrc.indexOf("key: 'development'");
    expect(roadmapIdx).toBeGreaterThan(-1);
    expect(developmentIdx).toBeGreaterThan(roadmapIdx);
  });
});
