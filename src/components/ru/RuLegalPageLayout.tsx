import Link from 'next/link';
import { ThemeProvider } from '@/theme/ThemeProvider';
import { ThemeSwitcher } from '@/components/ThemeSwitcher';
import { RuComplianceFooter } from '@/components/ru/RuComplianceFooter';

export function RuLegalPageLayout({
  title,
  children,
}: {
  title: string;
  children: React.ReactNode;
}) {
  return (
    <ThemeProvider defaultTheme="light" className="theme-transition min-h-screen bg-[var(--t-bg)] text-[var(--t-text)] flex flex-col">
      <header className="sticky top-0 z-50 bg-[color-mix(in_srgb,var(--t-bg)_92%,transparent)] backdrop-blur-md border-b border-[var(--t-border)]">
        <div className="max-w-6xl mx-auto px-4 sm:px-6 py-3.5 flex items-center justify-between gap-4">
          <Link href="/ru" className="text-lg font-bold text-[var(--t-text)] tracking-tight">
            ASI
          </Link>
          <div className="flex items-center gap-3">
            <Link
              href="/ru"
              className="text-sm text-[var(--t-muted)] hover:text-[var(--t-text)] transition-colors"
            >
              На главную
            </Link>
            <ThemeSwitcher />
          </div>
        </div>
      </header>

      <main className="flex-1 w-full max-w-2xl mx-auto px-4 sm:px-6 py-10 sm:py-14">
        <h1 className="text-2xl sm:text-3xl font-bold text-[var(--t-text)] tracking-tight">{title}</h1>
        <div className="mt-8 space-y-5 text-[var(--t-text-2)] text-sm sm:text-base leading-relaxed">
          {children}
        </div>
      </main>

      <RuComplianceFooter tone="theme" />
    </ThemeProvider>
  );
}
