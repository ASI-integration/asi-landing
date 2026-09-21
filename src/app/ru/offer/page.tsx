import type { Metadata } from 'next';
import { PrintPageButton } from '@/components/ru/PrintPageButton';
import { RuCommercialTimeline } from '@/components/ru/RuCommercialTimeline';
import { RuLegalPageLayout } from '@/components/ru/RuLegalPageLayout';
import { RU_OFFER_DOCUMENT } from '@/lib/ru-legal';

export const metadata: Metadata = {
  title: 'Публичная оферта — ASI',
  description: 'Публичная оферта на предоставление доступа к сервису ASI и оказание услуг по автоматизации.',
};

export default function RuOfferPage() {
  return (
    <RuLegalPageLayout
      title="Публичная оферта"
      intro="На предоставление доступа к сервису ASI и оказание услуг по автоматизации · редакция 1.1"
      wide
    >
      <div className="print:hidden"><RuCommercialTimeline compact /></div>
      <p className="border-l-2 border-asi-gold pl-4 text-base">
        Без оплаты на старте. Сначала подключаем и настраиваем объект, затем даём 14 дней полноценной работы ASI.
      </p>

      <div className="flex flex-wrap items-center gap-4 print:hidden">
        <PrintPageButton />
      </div>

      <nav aria-label="Содержание оферты" className="border border-asi-border bg-asi-paper p-5 print:hidden">
        <p className="font-semibold text-asi-navy">Содержание</p>
        <ol className="mt-3 columns-1 gap-8 sm:columns-2">
          {RU_OFFER_DOCUMENT.sections.map((section, index) => (
            <li key={section.heading} className="break-inside-avoid">
              <a href={`#offer-section-${index + 1}`}>{section.heading}</a>
            </li>
          ))}
        </ol>
      </nav>

      <div className="border-y border-asi-border py-6">
        <p className="font-serif text-2xl text-asi-navy">{RU_OFFER_DOCUMENT.title}</p>
        <p className="mt-2 font-medium text-asi-navy">{RU_OFFER_DOCUMENT.subtitle}</p>
        <p className="mt-1">Редакция {RU_OFFER_DOCUMENT.version}</p>
      </div>

      {RU_OFFER_DOCUMENT.sections.map((section, index) => (
        <section key={section.heading} id={`offer-section-${index + 1}`} className="scroll-mt-24 break-inside-avoid-page">
          <h2>{section.heading}</h2>
          {section.paragraphs.map((paragraph) => <p key={paragraph}>{paragraph}</p>)}
        </section>
      ))}
    </RuLegalPageLayout>
  );
}
