import { ThemeProvider } from '@/theme/ThemeProvider';
import { RuBottomQuickLinks } from '@/components/ru/RuBottomQuickLinks';
import { RuComplianceFooter } from '@/components/ru/RuComplianceFooter';
import { RuPublicNavHeader } from '@/components/ru/RuPublicNavHeader';

export function RuLegalPageLayout({
  title,
  children,
}: {
  title: string;
  children: React.ReactNode;
}) {
  return (
    <ThemeProvider defaultTheme="light" className="theme-transition min-h-screen bg-[var(--t-bg)] text-[var(--t-text)] flex flex-col">
      <RuPublicNavHeader surface="theme" density="legal" />

      <main className="flex-1 w-full max-w-2xl mx-auto px-4 sm:px-6 py-10 sm:py-14">
        <h1 className="text-2xl sm:text-3xl font-bold text-[var(--t-text)] tracking-tight">{title}</h1>
        <div className="mt-8 space-y-5 text-[var(--t-text-2)] text-sm sm:text-base leading-relaxed">
          {children}
        </div>
      </main>

      <RuBottomQuickLinks tone="theme" />
      <RuComplianceFooter tone="theme" />
    </ThemeProvider>
  );
}
