import Link from 'next/link';
import { legalConfig } from '@/config/legal';

export const metadata = {
  title: 'Политика конфиденциальности — ASI',
  description: 'Политика обработки персональных данных сервиса ASI.',
};

export default function PrivacyPage() {
  return (
    <div className="min-h-screen bg-white">
      <div className="max-w-2xl mx-auto px-4 sm:px-6 py-16">
        <Link href="/" className="text-slate-600 hover:text-slate-900 text-sm mb-8 inline-block">
          ← На главную
        </Link>

        <h1 className="text-2xl font-bold text-slate-900 tracking-tight">
          Политика конфиденциальности
        </h1>

        <div className="mt-8 space-y-6 text-slate-700 text-sm leading-relaxed">
          <section>
            <h2 className="font-semibold text-slate-900 mb-2">Оператор персональных данных:</h2>
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
            <h2 className="font-semibold text-slate-900 mb-2">Обрабатываемые данные:</h2>
            <p>
              Сервис ASI обрабатывает данные, необходимые для регистрации и оказания услуг:
              адрес электронной почты, данные для входа, данные об использовании сервиса и объектах
              аренды. Данные не передаются третьим лицам, за исключением случаев, предусмотренных
              законодательством.
            </p>
          </section>

          <section>
            <h2 className="font-semibold text-slate-900 mb-2">Цели обработки:</h2>
            <ul className="list-disc pl-5 space-y-2">
              <li>Предоставление доступа к сервису и его функциям.</li>
              <li>Связь с пользователем по вопросам использования сервиса.</li>
              <li>Улучшение работы сервиса и аналитика.</li>
            </ul>
          </section>
        </div>
      </div>
    </div>
  );
}
