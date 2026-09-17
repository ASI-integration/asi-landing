import type { Metadata } from 'next';
import Link from 'next/link';
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
    <RuLegalPageLayout title="Оплата и доставка услуги">
      <section className="space-y-3">
        <h2 className="text-base font-semibold text-[var(--t-text)]">Что продаётся</h2>
        <p>
          Платный MVP-тариф: <strong>{COMMUNICATION_PILOT_SERVICE_TITLE}</strong>.
        </p>
        <p>{COMMUNICATION_PILOT_PAYMENT_DESCRIPTION}.</p>
        <p>
          Стоимость: <strong>{COMMUNICATION_PILOT_PRICE_RUB}&nbsp;₽</strong> за один объект на один месяц.
        </p>
        <p>
          Подробное описание и заявка на подключение:{' '}
          <Link href="/ru/early-access" className="underline underline-offset-2">
            Пилот ASI
          </Link>
          .
        </p>
      </section>

      <section className="space-y-3">
        <h2 className="text-base font-semibold text-[var(--t-text)]">Как оказывается услуга</h2>
        <ol className="list-decimal space-y-2 pl-5">
          <li>Пользователь оставляет заявку на странице пилота или выбирает оплату на этой странице.</li>
          <li>Подключается один объект: клиент передаёт необходимые данные объекта (правила, Wi-Fi, заезд/выезд и т.п.).</li>
          <li>После подтверждения оплаты исполнитель настраивает объект в контуре AI-ответов гостям.</li>
          <li>
            Услуга оказывается дистанционно: типовые ответы гостям в цифровых каналах в рамках тарифа (1 объект, 1
            месяц). Нестандартные ситуации при необходимости передаются человеку.
          </li>
          <li>Сопровождение и уточнение настроек — по email, телефону или Telegram из раздела контактов.</li>
        </ol>
      </section>

      <section className="space-y-3">
        <h2 className="text-base font-semibold text-[var(--t-text)]">Способ оплаты</h2>
        <p>
          Оплата принимается безналично через платёжный сервис ЮKassa после завершения модерации мерчанта и включения
          приёма платежей на сайте.
        </p>
        <p>
          До включения ЮKassa кнопка оплаты показывает статус подключения и не создаёт платёж. Живые платежи и деплой
          продакшена в рамках этой подготовки не запускаются.
        </p>
        <PilotCheckoutCta />
      </section>

      <section className="space-y-3">
        <h2 className="text-base font-semibold text-[var(--t-text)]">Документы</h2>
        <ul className="list-disc space-y-2 pl-5">
          <li>
            <Link href={ruComplianceRoutes.offer} className="underline underline-offset-2">
              Публичная оферта
            </Link>
          </li>
          <li>
            <Link href={ruComplianceRoutes.refund} className="underline underline-offset-2">
              Возврат и отказ
            </Link>
          </li>
          <li>
            <Link href={ruComplianceRoutes.privacy} className="underline underline-offset-2">
              Политика конфиденциальности
            </Link>
          </li>
          <li>
            <Link href={ruComplianceRoutes.contacts} className="underline underline-offset-2">
              Контакты и реквизиты
            </Link>
          </li>
        </ul>
      </section>

      <section className="space-y-2">
        <h2 className="text-base font-semibold text-[var(--t-text)]">Исполнитель</h2>
        <p>Самозанятый: {ruCompliance.fullName}</p>
        <p>ИНН: {ruCompliance.inn}</p>
        <p>
          Email:{' '}
          <a href={`mailto:${ruCompliance.email}`} className="underline underline-offset-2">
            {ruCompliance.email}
          </a>
        </p>
        <p>
          Телефон:{' '}
          <a href={`tel:${ruCompliance.phoneTel}`} className="underline underline-offset-2">
            {ruCompliance.phone}
          </a>
        </p>
        <p>Адрес для корреспонденции: {ruCompliance.address}</p>
      </section>
    </RuLegalPageLayout>
  );
}
