import Link from 'next/link';
import { legalConfig } from '@/config/legal';

export const metadata = {
  title: 'Публичная оферта — ASI',
  description: 'Договор публичной оферты на оказание услуг сервиса ASI.',
};

export default function OfferPage() {
  return (
    <div className="min-h-screen bg-white">
      <div className="max-w-2xl mx-auto px-4 sm:px-6 py-16">
        <Link href="/" className="text-slate-600 hover:text-slate-900 text-sm mb-8 inline-block">
          ← На главную
        </Link>

        <h1 className="text-2xl font-bold text-slate-900 tracking-tight">
          Публичная оферта
        </h1>

        <div className="mt-8 space-y-6 text-slate-700 text-sm leading-relaxed">
          <section>
            <h2 className="font-semibold text-slate-900 mb-2">Исполнитель:</h2>
            <p>{legalConfig.name}</p>
            <p>ИНН: {legalConfig.inn}</p>
            <p>
              Email:{' '}
              <a href={`mailto:${legalConfig.email}`} className="text-slate-900 hover:underline">
                {legalConfig.email}
              </a>
            </p>
            <p>{legalConfig.status}</p>
          </section>

          <section>
            <h2 className="font-semibold text-slate-900 mb-2">Предмет оферты:</h2>
            <p>
              Настоящая оферта является официальным предложением на заключение договора оказания услуг
              по использованию сервиса ASI — платформы для автоматизации управления объектами
              краткосрочной аренды. Акцепт оферты осуществляется путём регистрации и начала
              использования сервиса.
            </p>
          </section>

          <section>
            <h2 className="font-semibold text-slate-900 mb-2">Условия:</h2>
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
