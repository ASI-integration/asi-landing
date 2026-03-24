import Link from 'next/link';
import { productSupportEmail } from '@/config/contact';
import { legalConfig } from '@/config/legal';

export const metadata = {
  title: 'Политика конфиденциальности — ASI',
  description: 'Политика обработки персональных данных сервиса ASI Integrations.',
};

export default function PrivacyPage() {
  return (
    <div className="min-h-screen bg-white">
      <div className="max-w-2xl mx-auto px-4 sm:px-6 py-16">
        <Link href="/" className="text-slate-500 hover:text-slate-900 text-sm mb-10 inline-block">
          ← На главную
        </Link>

        <h1 className="text-2xl sm:text-3xl font-bold text-slate-900 tracking-tight">
          Политика конфиденциальности
        </h1>
        <p className="mt-3 text-slate-500 text-sm">Дата вступления в силу: 1 января 2026 г.</p>

        <div className="mt-10 space-y-8 text-slate-700 text-sm leading-relaxed">

          {/* 1. Оператор */}
          <section>
            <h2 className="text-base font-semibold text-slate-900 mb-3">
              1. Оператор персональных данных
            </h2>
            <p>
              Настоящая Политика конфиденциальности распространяется на сайт{' '}
              <span className="font-medium text-slate-900">asi-global.ru</span> и сервис ASI
              Integrations.
            </p>
            <div className="mt-3 p-4 bg-slate-50 rounded-lg border border-slate-200 space-y-1">
              <p>
                <span className="font-medium text-slate-900">Оператор:</span>{' '}
                {legalConfig.name}
              </p>
              <p>
                <span className="font-medium text-slate-900">Статус:</span>{' '}
                {legalConfig.status}
              </p>
              <p>
                <span className="font-medium text-slate-900">ИНН:</span> {legalConfig.inn}
              </p>
              <p>
                <span className="font-medium text-slate-900">Местонахождение:</span>{' '}
                г. Санкт-Петербург, Россия
              </p>
              <p>
                <span className="font-medium text-slate-900">E-mail (правовые вопросы):</span>{' '}
                <a href={`mailto:${legalConfig.email}`} className="text-slate-900 hover:underline">
                  {legalConfig.email}
                </a>
              </p>
              <p>
                <span className="font-medium text-slate-900">E-mail (поддержка):</span>{' '}
                <a href={`mailto:${productSupportEmail}`} className="text-slate-900 hover:underline">
                  {productSupportEmail}
                </a>
              </p>
            </div>
          </section>

          {/* 2. Какие данные собираем */}
          <section>
            <h2 className="text-base font-semibold text-slate-900 mb-3">
              2. Какие данные мы собираем
            </h2>
            <p>
              Мы собираем только те данные, которые необходимы для работы сервиса:
            </p>
            <ul className="mt-3 list-disc pl-5 space-y-1.5">
              <li>Имя и фамилия (для идентификации аккаунта).</li>
              <li>Адрес электронной почты (для входа и связи).</li>
              <li>Номер телефона и/или Telegram (для оперативной связи, по желанию).</li>
              <li>Данные об объектах недвижимости (адрес, тип, количество — для настройки сервиса).</li>
              <li>Платёжные данные — обрабатываются исключительно платёжным агрегатором ЮKassa; оператор не хранит данные банковских карт.</li>
            </ul>
          </section>

          {/* 3. Цели обработки */}
          <section>
            <h2 className="text-base font-semibold text-slate-900 mb-3">
              3. Цели обработки персональных данных
            </h2>
            <ul className="list-disc pl-5 space-y-1.5">
              <li>Идентификация пользователя и предоставление доступа к сервису ASI.</li>
              <li>Настройка аккаунта и объектов недвижимости в системе.</li>
              <li>Связь с пользователем по техническим, платёжным и организационным вопросам.</li>
              <li>Обработка платежей и выставление счетов через ЮKassa.</li>
              <li>Исполнение обязательств по публичной оферте.</li>
              <li>Соблюдение требований законодательства РФ.</li>
            </ul>
          </section>

          {/* 4. Передача данных третьим лицам */}
          <section>
            <h2 className="text-base font-semibold text-slate-900 mb-3">
              4. Передача данных третьим лицам
            </h2>
            <p>
              Мы не передаём персональные данные третьим лицам, за исключением следующих случаев:
            </p>
            <ul className="mt-3 list-disc pl-5 space-y-1.5">
              <li>
                <span className="font-medium text-slate-900">ЮKassa</span> — платёжный агрегатор
                для проведения транзакций (в объёме, необходимом для обработки платежа).
              </li>
              <li>
                Случаи, прямо предусмотренные законодательством Российской Федерации (по запросу
                уполномоченных органов).
              </li>
            </ul>
          </section>

          {/* 5. Хранение и защита */}
          <section>
            <h2 className="text-base font-semibold text-slate-900 mb-3">
              5. Хранение и защита данных
            </h2>
            <p>
              Данные хранятся на защищённых серверах с использованием шифрования (TLS/HTTPS).
              Срок хранения персональных данных — в течение срока действия аккаунта и 3 лет после
              его удаления либо до момента отзыва согласия пользователем.
            </p>
          </section>

          {/* 6. Права пользователя */}
          <section>
            <h2 className="text-base font-semibold text-slate-900 mb-3">
              6. Права пользователя
            </h2>
            <p>В соответствии с Федеральным законом № 152-ФЗ «О персональных данных» вы вправе:</p>
            <ul className="mt-3 list-disc pl-5 space-y-1.5">
              <li>Получить сведения об обрабатываемых персональных данных.</li>
              <li>Потребовать исправления неточных данных.</li>
              <li>Потребовать удаления данных («право на забвение»).</li>
              <li>Отозвать согласие на обработку персональных данных.</li>
            </ul>
            <p className="mt-3">
              Для реализации прав направьте запрос на{' '}
              <a href={`mailto:${legalConfig.email}`} className="text-slate-900 hover:underline">
                {legalConfig.email}
              </a>
              .
            </p>
          </section>

          {/* 7. Cookies */}
          <section>
            <h2 className="text-base font-semibold text-slate-900 mb-3">7. Файлы cookie</h2>
            <p>
              Сайт использует технические cookie, необходимые для работы аутентификации и сохранения
              пользовательских настроек. Аналитические или рекламные cookie не используются.
            </p>
          </section>

          {/* 8. Изменения */}
          <section>
            <h2 className="text-base font-semibold text-slate-900 mb-3">
              8. Изменения политики
            </h2>
            <p>
              Оператор вправе вносить изменения в настоящую Политику. Актуальная версия всегда
              доступна по адресу{' '}
              <span className="font-medium text-slate-900">asi-global.ru/privacy</span>. Продолжение
              использования сервиса после публикации изменений означает согласие с новой редакцией.
            </p>
          </section>

        </div>

        <div className="mt-12 pt-8 border-t border-slate-200">
          <Link href="/offer" className="text-slate-500 hover:text-slate-900 text-sm">
            Публичная оферта →
          </Link>
        </div>
      </div>
    </div>
  );
}
