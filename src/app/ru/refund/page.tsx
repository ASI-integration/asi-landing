import type { Metadata } from 'next';
import { RuLegalPageLayout } from '@/components/ru/RuLegalPageLayout';
import { getAsiFeedbackBotHandle } from '@/config/publicTelegram';
import { ruCompliance } from '@/config/ruCompliance';

export const metadata: Metadata = {
  title: 'Возврат и отказ от покупки — ASI',
  description: 'Порядок отказа от услуги и возврата денежных средств.',
};

export default function RuRefundPage() {
  return (
    <RuLegalPageLayout title="Возврат и отказ от покупки">
      <p>Пользователь вправе отказаться от услуги до момента её фактического оказания.</p>
      <p>
        Если услуга уже оплачена, для отказа или запроса возврата денежных средств необходимо направить обращение по
        одному из контактных каналов:
      </p>
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
            {getAsiFeedbackBotHandle()}
          </a>
        </li>
      </ul>
      <p>В обращении необходимо указать:</p>
      <ul className="list-disc pl-5 space-y-2">
        <li>ФИО плательщика</li>
        <li>дату и сумму оплаты</li>
        <li>описание причины обращения</li>
        <li>контактные данные для обратной связи</li>
      </ul>
      <p>Порядок обработки обращения:</p>
      <ol className="list-decimal pl-5 space-y-2">
        <li>Пользователь направляет запрос на возврат или отказ от услуги.</li>
        <li>Мы проверяем данные платежа и основания обращения.</li>
        <li>При необходимости уточняем информацию у пользователя.</li>
        <li>По результатам проверки принимается решение о возврате денежных средств либо предоставляется мотивированный ответ.</li>
      </ol>
      <p>Срок рассмотрения обращения:</p>
      <ul className="list-disc pl-5 space-y-2">
        <li>до 10 рабочих дней с момента получения полного обращения</li>
      </ul>
      <p>Срок возврата денежных средств:</p>
      <ul className="list-disc pl-5 space-y-2">
        <li>
          до 10 рабочих дней после принятия положительного решения о возврате, если иной срок не предусмотрен правилами
          банка или платёжной системы
        </li>
      </ul>
      <p>
        Возврат денежных средств осуществляется тем же способом, которым была произведена оплата, если иной порядок не
        согласован дополнительно и не противоречит правилам платёжной системы и законодательству РФ.
      </p>
      <p>
        Если услуга уже была оказана в полном объёме, возврат производится с учётом фактически оказанных услуг и
        требований действующего законодательства Российской Федерации.
      </p>
    </RuLegalPageLayout>
  );
}
