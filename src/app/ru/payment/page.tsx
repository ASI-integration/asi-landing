import type { Metadata } from 'next';
import Link from 'next/link';
import { RuLegalPageLayout } from '@/components/ru/RuLegalPageLayout';
import { ruCompliance, ruComplianceRoutes } from '@/config/ruCompliance';

export const metadata: Metadata = {
  title: 'Оплата и доставка услуги — ASI',
  description: 'Тариф, способ оплаты и порядок оказания платной услуги ASI.',
};

export default function RuPaymentPage() {
  return (
    <RuLegalPageLayout
      title="Оплата и доставка услуги"
      intro="Платное продолжение возможно только после бесплатного периода и отдельного решения владельца аккаунта."
      wide
    >
      <div className="border border-asi-border bg-asi-paper p-6 sm:p-8 mb-2 !mt-0">
        <p className="text-[10px] font-sans font-semibold uppercase tracking-[0.18em] text-asi-gold-text !mb-0">
          Платное продолжение
        </p>
        <p className="mt-3 font-serif text-3xl sm:text-4xl text-asi-navy tracking-tight !mb-0">Только по вашему решению</p>
        <p className="mt-3 text-sm text-asi-navy/65 !mb-0">Никакого автоматического перехода на оплату.</p>
      </div>

      <section>
        <h2>Как принимается решение</h2>
        <p>После 14-дневного бесплатного периода владелец аккаунта сам решает, продолжать ли работу.</p>
        <p>До подтверждения в кабинете будет показана действующая цена для конкретного аккаунта и назначенное специальное предложение, если оно включено.</p>
        <p>
          Подробное описание и заявка на подключение:{' '}
          <Link href="/ru/early-access">Пилот ASI</Link>.
        </p>
      </section>

      <section>
        <h2>Как оказывается услуга</h2>
        <ol>
          <li>Пользователь оставляет заявку и бесплатно проходит подключение и настройку.</li>
          <li>
            Подключается один объект: клиент передаёт необходимые данные объекта (правила, Wi-Fi, заезд/выезд и
            т.п.).
          </li>
          <li>После подтверждения готовности начинается бесплатный период ровно на 14 календарных дней.</li>
          <li>
            После бесплатного периода владелец видит применимую цену и отдельно подтверждает платное продолжение.
          </li>
          <li>Сопровождение и уточнение настроек — по email, телефону или Telegram из раздела контактов.</li>
        </ol>
      </section>

      <section>
        <h2>Способ оплаты</h2>
        <p>Принятие оферты и согласия на обработку персональных данных не подключает способ оплаты и не разрешает регулярные списания.</p>
        <p>Оплата становится доступна только после отдельного подтверждения продолжения и показанной цены.</p>
      </section>

      <section>
        <h2>Документы</h2>
        <ul>
          <li>
            <Link href={ruComplianceRoutes.offer}>Публичная оферта</Link>
          </li>
          <li>
            <Link href={ruComplianceRoutes.refund}>Возврат и отказ</Link>
          </li>
          <li>
            <Link href={ruComplianceRoutes.privacy}>Политика конфиденциальности</Link>
          </li>
          <li>
            <Link href={ruComplianceRoutes.contacts}>Контакты и реквизиты</Link>
          </li>
        </ul>
      </section>

      <section>
        <h2>Исполнитель</h2>
        <p>Самозанятый: {ruCompliance.fullName}</p>
        <p>ИНН: {ruCompliance.inn}</p>
        <p>
          Email: <a href={`mailto:${ruCompliance.email}`}>{ruCompliance.email}</a>
        </p>
        <p>
          Телефон: <a href={`tel:${ruCompliance.phoneTel}`}>{ruCompliance.phone}</a>
        </p>
        <p>Адрес для корреспонденции: {ruCompliance.address}</p>
      </section>
    </RuLegalPageLayout>
  );
}
