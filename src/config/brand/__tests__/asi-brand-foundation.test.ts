import { readFileSync } from 'node:fs';
import { join } from 'node:path';
import { describe, expect, it } from 'vitest';
import {
  asiBrandColors,
  asiBrandButtonClasses,
  asiBrandLayout,
  asiBrandShiro,
} from '@/config/brand/tokens';

const root = process.cwd();

function readSrc(relativePath: string): string {
  return readFileSync(join(root, relativePath), 'utf8');
}

describe('ASI shared brand foundation', () => {
  it('keeps brand tokens free of market/legal content', () => {
    const tokens = readSrc('src/config/brand/tokens.ts');
    const brandIndex = readSrc('src/components/brand/index.ts');
    for (const src of [tokens, brandIndex]) {
      expect(src).not.toContain('Реутова');
      expect(src).not.toContain('235307941957');
      expect(src).not.toContain('support@asi-global.ru');
      expect(src).not.toContain('YooKassa');
      expect(src).not.toContain('ЮKassa');
      expect(src).not.toContain('/ru/payment');
      expect(src).not.toContain('1000');
    }
    expect(asiBrandColors.navy).toBe('#13151B');
    expect(asiBrandColors.ivory).toBe('#F7F3EA');
    expect(asiBrandShiro.assetPath).toBe('/brand/shiro-badge.png');
    expect(asiBrandLayout.contentMaxClass).toBe('max-w-6xl');
    expect(asiBrandButtonClasses.primary).toContain('bg-asi-navy');
  });

  it('RU shell uses shared brand chrome without engineering /pilot nav', () => {
    const header = readSrc('src/components/ru/RuPublicNavHeader.tsx');
    expect(header).toContain('bg-asi-ivory/90');
    expect(header).toContain('BrandLogoMark');
    expect(header).toContain('/ru/early-access');
    expect(header).toContain('Подключить пилот');
    expect(header).not.toMatch(/href=\{?['"]\/pilot['"]\}?/);
    expect(header).toContain('Войти');

    const footer = readSrc('src/components/ru/RuComplianceFooter.tsx');
    expect(footer).toContain('bg-asi-navy');
    expect(footer).toContain('BrandShiro');
    expect(footer).toContain('ruCompliance.fullName');
    expect(footer).toContain('ruComplianceRoutes.payment');
  });

  it('tailwind asi tokens remain the palette source of truth', () => {
    const tw = readSrc('tailwind.config.js');
    expect(tw).toContain("ivory: '#F7F3EA'");
    expect(tw).toContain("navy: '#13151B'");
    expect(tw).toContain("gold: '#A6813C'");
    expect(tw).toContain('Iowan Old Style');
  });

  it('documents the one-brand contract', () => {
    const doc = readSrc('docs/design/ASI_BRAND_SYSTEM.md');
    expect(doc).toContain('guestautopilot.com');
    expect(doc).toMatch(/no separate Russian visual identity/i);
    expect(doc).toContain('Shiro');
    expect(doc).toMatch(/asi-global\.com.*out of scope/i);
  });
});
