import type { Metadata } from 'next';
import { RuLegalPageLayout } from '@/components/ru/RuLegalPageLayout';
import { ruCompliance } from '@/config/ruCompliance';

export const metadata: Metadata = {
  title: 'Контакты — ASI',
  description: 'Контакты исполнителя и порядок обращений пользователей.',
};

export default function RuContactsPage() {
  return (
    <RuLegalPageLayout title="Контакты">
      <p>Связаться с нами можно следующими способами:</p>
      <ul className="list-disc pl-5 space-y-2">
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
          Telegram:{' '}
          <a
            href={ruCompliance.telegram}
            target="_blank"
            rel="noopener noreferrer"
            className="text-[var(--t-text)] underline underline-offset-2 decoration-[var(--t-border)] hover:decoration-[var(--t-text)] break-all"
          >
            @ASI_core_bot
          </a>
        </li>
        {ruCompliance.phone ? <li>Телефон: {ruCompliance.phone}</li> : null}
      </ul>
      <p>
        Мы отвечаем на обращения пользователей по вопросам подключения, оплаты, возврата денежных средств, доступа к
        сервису и технической поддержки.
      </p>
      <p>Время обработки обращений:</p>
      <ul className="list-disc pl-5 space-y-2">
        <li>по общим вопросам: в разумный срок в рабочее время</li>
        <li>по вопросам оплаты и возвратов: в приоритетном порядке после получения обращения</li>
      </ul>
      <p>Реквизиты исполнителя:</p>
      <ul className="list-disc pl-5 space-y-2">
        <li>Самозанятый: {ruCompliance.fullName}</li>
        <li>ИНН: {ruCompliance.inn}</li>
        {ruCompliance.address ? <li>Адрес для корреспонденции: {ruCompliance.address}</li> : null}
      </ul>
    </RuLegalPageLayout>
  );
}
