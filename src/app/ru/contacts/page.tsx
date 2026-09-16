import type { Metadata } from 'next';
import { RuLegalPageLayout } from '@/components/ru/RuLegalPageLayout';
import { ruCompliance } from '@/config/ruCompliance';
import { telegramSupportBotHandle } from '@/config/telegramBots';

export const metadata: Metadata = {
  title: 'Контакты и реквизиты — ASI',
  description: 'Контакты исполнителя и ссылки на правовые документы ASI.',
};

export default function RuContactsPage() {
  return (
    <RuLegalPageLayout title="Контакты и реквизиты">
      <section className="space-y-3">
        <h2 className="text-base font-semibold text-[var(--t-text)]">Связь</h2>
        <ul className="list-disc space-y-2 pl-5">
          <li>
            Email:{' '}
            <a
              href={`mailto:${ruCompliance.email}`}
              className="text-[var(--t-text)] underline underline-offset-2 decoration-[var(--t-border)] hover:decoration-[var(--t-text)]"
            >
              {ruCompliance.email}
            </a>
          </li>
          <li>
            Телефон:{' '}
            <a
              href={`tel:${ruCompliance.phoneTel}`}
              className="text-[var(--t-text)] underline underline-offset-2 decoration-[var(--t-border)] hover:decoration-[var(--t-text)]"
            >
              {ruCompliance.phone}
            </a>
          </li>
          <li>
            Telegram:{' '}
            <a
              href={ruCompliance.telegram}
              target="_blank"
              rel="noopener noreferrer"
              className="text-[var(--t-text)] underline underline-offset-2 decoration-[var(--t-border)] hover:decoration-[var(--t-text)] break-all"
            >
              @{telegramSupportBotHandle}
            </a>
          </li>
        </ul>
      </section>

      <section className="space-y-3">
        <h2 className="text-base font-semibold text-[var(--t-text)]">Реквизиты исполнителя</h2>
        <ul className="list-disc space-y-2 pl-5">
          <li>Самозанятый: {ruCompliance.fullName}</li>
          <li>ИНН: {ruCompliance.inn}</li>
          <li>Адрес для корреспонденции: {ruCompliance.address}</li>
        </ul>
      </section>

      <section className="space-y-3">
        <h2 className="text-base font-semibold text-[var(--t-text)]">Документы</h2>
        <ul className="list-disc space-y-2 pl-5">
          <li>
            <a href="/ru/offer" className="underline underline-offset-2">
              Публичная оферта
            </a>
          </li>
          <li>
            <a href="/ru/privacy" className="underline underline-offset-2">
              Политика конфиденциальности
            </a>
          </li>
          <li>
            <a href="/ru/payment" className="underline underline-offset-2">
              Оплата и доставка услуги
            </a>
          </li>
          <li>
            <a href="/ru/refund" className="underline underline-offset-2">
              Возврат и отказ
            </a>
          </li>
        </ul>
      </section>
    </RuLegalPageLayout>
  );
}
