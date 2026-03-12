import Link from 'next/link';

export const metadata = {
  title: 'Правовая информация — ASI',
  description: 'Юридическая информация и условия использования сервиса ASI.',
};

const LEGAL_NAME = 'Реутова Юлия Игоревна';
const LEGAL_INN = '235307941957';
const LEGAL_EMAIL = 'Glaigmalts@ya.ru';

export default function LegalPage() {
  return (
    <div className="min-h-screen bg-white">
      <div className="max-w-2xl mx-auto px-4 sm:px-6 py-16">
        <Link href="/" className="text-slate-600 hover:text-slate-900 text-sm mb-8 inline-block">
          ← На главную
        </Link>

        <h1 className="text-2xl font-bold text-slate-900 tracking-tight">
          Правовая информация
        </h1>

        <div className="mt-8 space-y-6 text-slate-700 text-sm leading-relaxed">
          <section>
            <h2 className="font-semibold text-slate-900 mb-2">ИП или самозанятый:</h2>
            <p>{LEGAL_NAME}</p>
            <p>ИНН: {LEGAL_INN}</p>
            <p>
              Email:{' '}
              <a href={`mailto:${LEGAL_EMAIL}`} className="text-slate-900 hover:underline">
                {LEGAL_EMAIL}
              </a>
            </p>
          </section>

          <section>
            <h2 className="font-semibold text-slate-900 mb-2">Описание услуги:</h2>
            <p>
              ASI — SaaS-платформа для автоматизации управления объектами краткосрочной аренды.
              Сервис предоставляет инструменты автоматизации бронирований, коммуникации и аналитики.
            </p>
          </section>

          <section>
            <h2 className="font-semibold text-slate-900 mb-2">Условия оказания услуг:</h2>
            <ul className="list-disc pl-5 space-y-2">
              <li>Подписка оплачивается ежемесячно.</li>
              <li>Бесплатный пробный период — 14 дней.</li>
              <li>Отмена возможна в любой момент.</li>
              <li>Возврат средств не предусмотрен после начала платного периода.</li>
            </ul>
          </section>
        </div>
      </div>
    </div>
  );
}
