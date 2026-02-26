import Link from 'next/link';

export function LegalFooter() {
  return (
    <footer className="py-4 px-4 sm:px-6 border-t border-slate-200 bg-white">
      <div className="max-w-6xl mx-auto flex flex-col sm:flex-row justify-between items-center gap-2 text-slate-600 text-sm">
        <span>ИНН 470321944609 · Николай Гопенко · Самозанятый</span>
        <Link href="/legal" className="hover:text-slate-900">
          Правовая информация
        </Link>
      </div>
    </footer>
  );
}
