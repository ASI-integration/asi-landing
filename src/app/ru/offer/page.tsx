import type { Metadata } from 'next';
import { RuLegalPageLayout } from '@/components/ru/RuLegalPageLayout';
import { getAsiFeedbackBotHandle } from '@/config/publicTelegram';
import { ruCompliance } from '@/config/ruCompliance';

export const metadata: Metadata = {
  title: 'Публичная оферта — ASI',
  description: 'Публичная оферта на оказание информационных и цифровых услуг.',
};

export default function RuOfferPage() {
  return (
    <RuLegalPageLayout title="Публичная оферта">
      <p>
        Настоящий документ является предложением заключить договор на оказание информационных и/или цифровых услуг на
        условиях, изложенных ниже.
      </p>

      <section className="space-y-3">
        <h2 className="text-base font-semibold text-[var(--t-text)]">1. Общие положения</h2>
        <p>
          Исполнитель предоставляет пользователю доступ к функциональности сервиса, размещённой на сайте, на условиях
          выбранного тарифа или услуги.
        </p>
      </section>

      <section className="space-y-3">
        <h2 className="text-base font-semibold text-[var(--t-text)]">2. Оформление заказа</h2>
        <p>
          Заказ оформляется пользователем путём выбора соответствующей услуги, заполнения необходимых данных и
          подтверждения намерения оплатить услугу на сайте.
        </p>
      </section>

      <section className="space-y-3">
        <h2 className="text-base font-semibold text-[var(--t-text)]">3. Момент заключения договора</h2>
        <p>
          Договор считается заключённым с момента подтверждения оплаты выбранной услуги, если иное не указано на странице
          услуги.
        </p>
      </section>

      <section className="space-y-3">
        <h2 className="text-base font-semibold text-[var(--t-text)]">4. Порядок оказания услуг</h2>
        <p>Услуги оказываются дистанционно через сайт и/или связанные цифровые каналы сервиса.</p>
        <p>
          Сроки предоставления доступа или начала оказания услуги определяются описанием соответствующей услуги на сайте
          либо следуют сразу после подтверждения оплаты, если иное не указано отдельно.
        </p>
      </section>

      <section className="space-y-3">
        <h2 className="text-base font-semibold text-[var(--t-text)]">5. Стоимость и оплата</h2>
        <p>Стоимость услуг указывается на сайте.</p>
        <p>Оплата производится безналичным способом с использованием доступных платёжных инструментов.</p>
      </section>

      <section className="space-y-3">
        <h2 className="text-base font-semibold text-[var(--t-text)]">6. Права и обязанности сторон</h2>
        <p>
          Исполнитель обязуется предоставить пользователю доступ к оплаченной функциональности или услуге в соответствии с
          описанием на сайте.
        </p>
        <p>
          Пользователь обязуется предоставить корректные данные, необходимые для оказания услуги, и соблюдать правила
          использования сервиса.
        </p>
      </section>

      <section className="space-y-3">
        <h2 className="text-base font-semibold text-[var(--t-text)]">7. Возврат и отказ</h2>
        <p>
          Порядок отказа от услуги и возврата денежных средств определяется отдельной страницей «Возврат и отказ от
          покупки», размещённой на сайте.
        </p>
      </section>

      <section className="space-y-3">
        <h2 className="text-base font-semibold text-[var(--t-text)]">8. Реквизиты исполнителя</h2>
        <p>Исполнитель: {ruCompliance.fullName}, самозанятый</p>
        <p>ИНН: {ruCompliance.inn}</p>
        <p>
          Email:{' '}
          <a
            href={`mailto:${ruCompliance.email}`}
            className="text-[var(--t-text)] underline underline-offset-2 decoration-[var(--t-border)] hover:decoration-[var(--t-text)]"
          >
            {ruCompliance.email}
          </a>
        </p>
        <p>
          Telegram:{' '}
          <a
            href={ruCompliance.telegram}
            target="_blank"
            rel="noopener noreferrer"
            className="text-[var(--t-text)] underline underline-offset-2 decoration-[var(--t-border)] hover:decoration-[var(--t-text)] break-all"
          >
            {getAsiFeedbackBotHandle()}
          </a>
        </p>
      </section>
    </RuLegalPageLayout>
  );
}
