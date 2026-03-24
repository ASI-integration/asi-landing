import Link from 'next/link';

export function LegalFooter() {
  return (
    <footer className="bg-slate-950 text-slate-500 py-8 border-t border-slate-900">
      <div className="max-w-5xl mx-auto px-4 sm:px-6 text-sm leading-relaxed">
        <div className="flex flex-col md:flex-row justify-between gap-6">
          <div>
            <p className="font-semibold text-slate-300">Реутова Юлия Игоревна</p>
            <p className="mt-1">ИНН: 235307941957</p>
            <p>Местонахождение: г. Мурино, Ленинградская обл.</p>
          </div>
          <div className="space-y-1">
            <p>© 2026 ASI Integrations. Все права защищены.</p>
            <div className="flex flex-wrap gap-x-4 gap-y-1">
              <Link href="/privacy" className="hover:text-slate-300 transition-colors">
                Политика конфиденциальности
              </Link>
              <Link href="/offer" className="hover:text-slate-300 transition-colors">
                Оферта
              </Link>
            </div>
          </div>
          <div>
            <p>
              Email:{' '}
              <a
                href="mailto:support@asi.system"
                className="hover:text-slate-300 transition-colors"
              >
                support@asi.system
              </a>
            </p>
          </div>
        </div>
      </div>
    </footer>
  );
}
