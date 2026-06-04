import type { Metadata } from 'next';
import { RuLegalPageLayout } from '@/components/ru/RuLegalPageLayout';
import { ruCompliance } from '@/config/ruCompliance';
import {
  COMMUNICATION_PILOT_PAYMENT_DESCRIPTION,
  COMMUNICATION_PILOT_PRICE_RUB,
  COMMUNICATION_PILOT_SERVICE_TITLE,
} from '@/lib/payments/yookassa-env';

export const metadata: Metadata = {
  title: 'Оплата — ASI',
  description: 'Условия и порядок оплаты услуг сервиса.',
};

export default function RuPaymentPage() {
  return (
    <RuLegalPageLayout title="Оплата">
      <p>Оплата услуг сервиса производится в безналичной форме с использованием доступных на сайте способов оплаты.</p>
      <p>
        После выбора подходящего тарифа или услуги пользователь переходит к оформлению заказа и оплате. Обязательство по
        оплате считается исполненным с момента подтверждения успешного платежа платёжной системой.
      </p>
      <p>
        Если иное не указано на странице конкретной услуги, доступ к платным функциям, материалам или сервису
        предоставляется после подтверждения оплаты.
      </p>
      <p>Стоимость услуг указывается на сайте в рублях Российской Федерации.</p>
      <section className="space-y-2 rounded-lg border border-[var(--t-border)] bg-[var(--t-surface-2)] p-4">
        <h2 className="text-base font-semibold text-[var(--t-text)]">Текущая услуга раннего доступа</h2>
        <p>{COMMUNICATION_PILOT_SERVICE_TITLE}</p>
        <p>{COMMUNICATION_PILOT_PAYMENT_DESCRIPTION}</p>
        <p>Стоимость: {COMMUNICATION_PILOT_PRICE_RUB} ₽ за объект в месяц.</p>
      </section>
      <p>
        При необходимости пользователь может запросить подтверждение оплаты, обратившись по контактам, указанным на
        странице «Контакты».
      </p>

      <section className="space-y-2 pt-2">
        <h2 className="text-base font-semibold text-[var(--t-text)]">Реквизиты исполнителя</h2>
        <p>Самозанятый: {ruCompliance.fullName}</p>
        <p>ИНН: {ruCompliance.inn}</p>
      </section>
    </RuLegalPageLayout>
  );
}
