import type { Metadata } from 'next';
import Link from 'next/link';
import { BrandGoldRule } from '@/components/brand';
import { RuLegalPageLayout } from '@/components/ru/RuLegalPageLayout';
import { PilotCheckoutCta } from '@/components/ru/PilotCheckoutCta';
import { ruCompliance, ruComplianceRoutes } from '@/config/ruCompliance';
import {
  COMMUNICATION_PILOT_PAYMENT_DESCRIPTION,
  COMMUNICATION_PILOT_PRICE_RUB,
  COMMUNICATION_PILOT_SERVICE_TITLE,
} from '@/lib/payments/yookassa-env';

export const metadata: Metadata = {
  title: 'Оплата и доставка услуги — ASI',
  description: 'Тариф, способ оплаты и порядок оказания платной услуги ASI.',
};

export default function RuPaymentPage() {
  return (
    <RuLegalPageLayout
      title="Оплата и доставка услуги"
      intro="Условия оплаты закрытого пилота AI-коммуникаций: состав услуги, стоимость и статус приёма платежей."
      wide
    >
      <div className="border border-asi-border bg-asi-paper p-6 sm:p-8 mb-2 !mt-0">
        <p className="text-[10px] font-sans font-semibold uppercase tracking-[0.18em] text-asi-gold-text !mb-0">
          Тариф пилота
        </p>
        <p className="mt-3 font-serif text-4xl sm:text-5xl text-asi-navy tracking-tight !mb-0">
          {COMMUNICATION_PILOT_PRICE_RUB}&nbsp;₽
        </p>
        <p className="mt-2 text-asi-navy/65 !mb-0">1 объект · 1 месяц</p>
        <BrandGoldRule className="mt-5 mb-5" />
        <p className="font-serif text-lg text-asi-navy !mb-0">{COMMUNICATION_PILOT_SERVICE_TITLE}</p>
        <p className="mt-2 text-sm text-asi-navy/65 !mb-0">{COMMUNICATION_PILOT_PAYMENT_DESCRIPTION}.</p>
      </div>

      <section>
        <h2>Что продаётся</h2>
        <p>
          Платный MVP-тариф: <strong>{COMMUNICATION_PILOT_SERVICE_TITLE}</strong>.
        </p>
        <p>{COMMUNICATION_PILOT_PAYMENT_DESCRIPTION}.</p>
        <p>
          Стоимость: <strong>{COMMUNICATION_PILOT_PRICE_RUB}&nbsp;₽</strong> за один объект на один месяц.
        </p>
        <p>
          Подробное описание и заявка на подключение:{' '}
          <Link href="/ru/early-access">Пилот ASI</Link>.
        </p>
      </section>

      <section>
        <h2>Как оказывается услуга</h2>
        <ol>
          <li>Пользователь оставляет заявку на странице пилота или выбирает оплату на этой странице.</li>
          <li>
            Подключается один объект: клиент передаёт необходимые данные объекта (правила, Wi-Fi, заезд/выезд и
            т.п.).
          </li>
          <li>После подтверждения оплаты исполнитель настраивает объект в контуре AI-ответов гостям.</li>
          <li>
            Услуга оказывается дистанционно: типовые ответы гостям в цифровых каналах в рамках тарифа (1 объект, 1
            месяц). Нестандартные ситуации при необходимости передаются человеку.
          </li>
          <li>Сопровождение и уточнение настроек — по email, телефону или Telegram из раздела контактов.</li>
        </ol>
      </section>

      <section>
        <h2>Способ оплаты</h2>
        <p>
          Оплата принимается безналично через платёжный сервис ЮKassa после завершения модерации мерчанта и включения
          приёма платежей на сайте.
        </p>
        <p>
          До включения ЮKassa кнопка оплаты показывает статус подключения и не создаёт платёж. Живые платежи и деплой
          продакшена в рамках этой подготовки не запускаются.
        </p>
        <div className="mt-6 border border-asi-border bg-asi-ivory p-5 sm:p-6">
          <PilotCheckoutCta />
        </div>
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
