import Link from 'next/link';
import { productSupportEmail } from '@/config/contact';
import { legalConfig } from '@/config/legal';

export const metadata = {
  title: 'Публичная оферта — ASI',
  description: 'Договор публичной оферты на предоставление доступа к программному комплексу ASI Integrations.',
};

export default function OfferPage() {
  return (
    <div className="min-h-screen bg-white">
      <div className="max-w-2xl mx-auto px-4 sm:px-6 py-16">
        <Link href="/" className="text-slate-500 hover:text-slate-900 text-sm mb-10 inline-block">
          ← На главную
        </Link>

        <h1 className="text-2xl sm:text-3xl font-bold text-slate-900 tracking-tight">
          Публичная оферта
        </h1>
        <p className="mt-3 text-slate-500 text-sm">Дата вступления в силу: 1 января 2026 г.</p>

        <div className="mt-10 space-y-8 text-slate-700 text-sm leading-relaxed">

          {/* 1. Исполнитель */}
          <section>
            <h2 className="text-base font-semibold text-slate-900 mb-3">1. Исполнитель</h2>
            <div className="p-4 bg-slate-50 rounded-lg border border-slate-200 space-y-1">
              <p>
                <span className="font-medium text-slate-900">Наименование:</span>{' '}
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

          {/* 2. Предмет */}
          <section>
            <h2 className="text-base font-semibold text-slate-900 mb-3">2. Предмет оферты</h2>
            <p>
              Настоящая оферта является официальным предложением Исполнителя неограниченному кругу
              лиц (далее — Пользователь) заключить договор на предоставление доступа к{' '}
              <span className="font-medium text-slate-900">
                программному комплексу ASI Integrations
              </span>{' '}
              по модели подписки (SaaS).
            </p>
            <p className="mt-3">
              Программный комплекс ASI предназначен для автоматизации управления объектами
              краткосрочной аренды: управление объявлениями, обработка бронирований, взаимодействие
              с гостями через Telegram-бот, интеграция с платёжными системами.
            </p>
            <p className="mt-3">
              Акцепт настоящей оферты осуществляется путём регистрации аккаунта на сайте{' '}
              <span className="font-medium text-slate-900">asi-global.ru</span> или оплаты
              подписки. С момента акцепта оферта считается заключённым договором между Исполнителем
              и Пользователем.
            </p>
          </section>

          {/* 3. Порядок предоставления доступа */}
          <section>
            <h2 className="text-base font-semibold text-slate-900 mb-3">
              3. Порядок предоставления доступа
            </h2>
            <ul className="list-disc pl-5 space-y-1.5">
              <li>
                Доступ к программному комплексу предоставляется в течение{' '}
                <span className="font-medium text-slate-900">24 часов</span> после подтверждения
                оплаты.
              </li>
              <li>
                После регистрации Пользователю может быть предоставлен бесплатный пробный период.
                Продолжительность и условия пробного периода указываются на сайте asi-global.ru.
              </li>
              <li>
                Доступ предоставляется на срок оплаченного периода подписки (месяц, квартал или год
                — в зависимости от выбранного тарифа).
              </li>
            </ul>
          </section>

          {/* 4. Стоимость и оплата */}
          <section>
            <h2 className="text-base font-semibold text-slate-900 mb-3">
              4. Стоимость и порядок оплаты
            </h2>
            <p>
              Стоимость подписки определяется актуальным тарифом, опубликованным на сайте
              asi-global.ru. Исполнитель вправе изменять тарифы с уведомлением Пользователя не
              менее чем за 7 календарных дней до вступления изменений в силу.
            </p>
            <p className="mt-3">
              Оплата осуществляется через платёжный агрегатор{' '}
              <span className="font-medium text-slate-900">ЮKassa</span> (ООО «ЮМани», лицензия
              Банка России). Принимаются банковские карты Visa, Mastercard, МИР, а также иные
              методы оплаты, доступные через ЮKassa.
            </p>
            <p className="mt-3">
              Оплата считается произведённой с момента получения подтверждения от платёжного
              агрегатора.
            </p>
          </section>

          {/* Что оплачивается онлайн */}
          <section className="p-5 bg-slate-50 rounded-xl border border-slate-200">
            <h2 className="text-base font-semibold text-slate-900 mb-3">
              Что оплачивается онлайн
            </h2>
            <p className="mb-3">Через ASI онлайн может оплачиваться:</p>
            <ul className="list-disc pl-5 space-y-1.5">
              <li>
                подписка на использование сервиса ASI для владельцев и управляющих объектами
                недвижимости;
              </li>
              <li>
                дополнительные услуги и согласованные доплаты в рамках сценария бронирования,
                если они используются через платформу.
              </li>
            </ul>
            <p className="mt-3 text-slate-500">
              Например: ранний заезд, поздний выезд, продление проживания и другие дополнительные
              услуги.
            </p>
            <p className="mt-3 text-slate-500 text-xs">
              Конкретный сценарий оплаты зависит от конфигурации и подключённых модулей проекта.
            </p>
          </section>

          {/* Как происходит оплата */}
          <section className="p-5 bg-slate-50 rounded-xl border border-slate-200">
            <h2 className="text-base font-semibold text-slate-900 mb-3">
              Как происходит оплата
            </h2>
            <p className="mb-3">
              ASI не является классическим интернет-магазином с корзиной товаров. Оплата в
              сервисе может происходить:
            </p>
            <ul className="list-disc pl-5 space-y-1.5">
              <li>через личный кабинет;</li>
              <li>по платёжной ссылке;</li>
              <li>по QR;</li>
              <li>в рамках конкретного пользовательского сценария внутри платформы.</li>
            </ul>
            <p className="mt-3">
              Платёж привязывается не к набору товаров, а к подписке, бронированию или конкретной
              услуге / доплате.
            </p>
          </section>

          {/* 5. Условия подписки */}
          <section>
            <h2 className="text-base font-semibold text-slate-900 mb-3">5. Условия подписки</h2>
            <ul className="list-disc pl-5 space-y-1.5">
              <li>Подписка оплачивается авансом за выбранный период.</li>
              <li>По истечении оплаченного периода доступ приостанавливается до следующего платежа.</li>
              <li>Пользователь вправе отменить подписку в любой момент; доступ сохраняется до конца оплаченного периода.</li>
              <li>
                Возврат денежных средств за неиспользованный период не осуществляется, за исключением
                случаев технической неработоспособности сервиса по вине Исполнителя продолжительностью
                более 72 часов подряд.
              </li>
            </ul>
          </section>

          {/* 6. Права и обязанности */}
          <section>
            <h2 className="text-base font-semibold text-slate-900 mb-3">
              6. Права и обязанности сторон
            </h2>
            <p className="font-medium text-slate-900">Исполнитель обязуется:</p>
            <ul className="mt-2 list-disc pl-5 space-y-1.5">
              <li>Обеспечить работоспособность сервиса не менее 99% времени в месяц (SLA).</li>
              <li>Предоставлять техническую поддержку по e-mail в течение 1 рабочего дня.</li>
              <li>Уведомлять о плановых технических работах не менее чем за 24 часа.</li>
              <li>Хранить персональные данные в соответствии с Политикой конфиденциальности.</li>
            </ul>
            <p className="mt-4 font-medium text-slate-900">Пользователь обязуется:</p>
            <ul className="mt-2 list-disc pl-5 space-y-1.5">
              <li>Использовать сервис в соответствии с его назначением и законодательством РФ.</li>
              <li>Не передавать доступ к аккаунту третьим лицам.</li>
              <li>Своевременно вносить оплату за подписку.</li>
            </ul>
          </section>

          {/* 7. Ограничение ответственности */}
          <section>
            <h2 className="text-base font-semibold text-slate-900 mb-3">
              7. Ограничение ответственности
            </h2>
            <p>
              Исполнитель не несёт ответственности за убытки Пользователя, возникшие вследствие
              действий третьих лиц (платёжных систем, интернет-провайдеров, площадок бронирования),
              а также форс-мажорных обстоятельств. Совокупная ответственность Исполнителя по
              настоящей оферте не превышает суммы, уплаченной Пользователем за последний
              расчётный период.
            </p>
          </section>

          {/* 8. Разрешение споров */}
          <section>
            <h2 className="text-base font-semibold text-slate-900 mb-3">8. Разрешение споров</h2>
            <p>
              Все споры решаются путём переговоров. При недостижении согласия — в судебном порядке
              по месту нахождения Исполнителя в соответствии с законодательством Российской
              Федерации.
            </p>
          </section>

          {/* 9. Реквизиты */}
          <section>
            <h2 className="text-base font-semibold text-slate-900 mb-3">9. Реквизиты исполнителя</h2>
            <div className="p-4 bg-slate-50 rounded-lg border border-slate-200 space-y-1">
              <p>{legalConfig.name}</p>
              <p>ИНН: {legalConfig.inn}</p>
              <p>{legalConfig.status}, плательщик налога на профессиональный доход (НПД)</p>
              <p>г. Санкт-Петербург, Россия</p>
              <p>
                E-mail:{' '}
                <a href={`mailto:${legalConfig.email}`} className="text-slate-900 hover:underline">
                  {legalConfig.email}
                </a>
              </p>
            </div>
          </section>

        </div>

        <div className="mt-12 pt-8 border-t border-slate-200">
          <Link href="/privacy" className="text-slate-500 hover:text-slate-900 text-sm">
            Политика конфиденциальности →
          </Link>
        </div>
      </div>
    </div>
  );
}
