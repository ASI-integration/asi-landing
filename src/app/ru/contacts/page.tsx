import type { Metadata } from 'next';
import { RuLegalPageLayout } from '@/components/ru/RuLegalPageLayout';
import { ruCompliance, ruComplianceRoutes } from '@/config/ruCompliance';
import { telegramSupportBotHandle } from '@/config/telegramBots';

export const metadata: Metadata = {
  title: 'Контакты и реквизиты — ASI',
  description: 'Контакты исполнителя и ссылки на правовые документы ASI.',
};

export default function RuContactsPage() {
  return (
    <RuLegalPageLayout
      title="Контакты и реквизиты"
      intro="Как связаться с исполнителем и где посмотреть юридические документы."
      wide
    >
      <div className="grid sm:grid-cols-2 gap-px bg-asi-border border border-asi-border mb-2 !mt-0">
        <div className="bg-asi-paper p-6 sm:p-7">
          <p className="text-[10px] font-sans font-semibold uppercase tracking-[0.18em] text-asi-gold-text !mb-0">
            Связь
          </p>
          <ul className="mt-4 !pl-0 !list-none space-y-4">
            <li>
              <span className="block text-xs text-asi-navy/50 mb-1">Email</span>
              <a href={`mailto:${ruCompliance.email}`}>{ruCompliance.email}</a>
            </li>
            <li>
              <span className="block text-xs text-asi-navy/50 mb-1">Телефон</span>
              <a href={`tel:${ruCompliance.phoneTel}`}>{ruCompliance.phone}</a>
            </li>
            <li>
              <span className="block text-xs text-asi-navy/50 mb-1">Telegram</span>
              <a href={ruCompliance.telegram} target="_blank" rel="noopener noreferrer">
                @{telegramSupportBotHandle}
              </a>
            </li>
          </ul>
        </div>
        <div className="bg-asi-paper p-6 sm:p-7">
          <p className="text-[10px] font-sans font-semibold uppercase tracking-[0.18em] text-asi-gold-text !mb-0">
            Реквизиты
          </p>
          <ul className="mt-4 !pl-0 !list-none space-y-4">
            <li>
              <span className="block text-xs text-asi-navy/50 mb-1">Самозанятый</span>
              <span className="text-asi-navy">{ruCompliance.fullName}</span>
            </li>
            <li>
              <span className="block text-xs text-asi-navy/50 mb-1">ИНН</span>
              <span className="text-asi-navy">{ruCompliance.inn}</span>
            </li>
            <li>
              <span className="block text-xs text-asi-navy/50 mb-1">Адрес для корреспонденции</span>
              <span className="text-asi-navy">{ruCompliance.address}</span>
            </li>
          </ul>
        </div>
      </div>

      <section>
        <h2>Документы</h2>
        <ul>
          <li>
            <a href={ruComplianceRoutes.offer}>Публичная оферта</a>
          </li>
          <li>
            <a href={ruComplianceRoutes.privacy}>Политика конфиденциальности</a>
          </li>
          <li>
            <a href={ruComplianceRoutes.payment}>Оплата и доставка услуги</a>
          </li>
          <li>
            <a href={ruComplianceRoutes.refund}>Возврат и отказ</a>
          </li>
        </ul>
      </section>
    </RuLegalPageLayout>
  );
}
