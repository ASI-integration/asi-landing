import type { Metadata } from 'next';
import Link from 'next/link';
import { RuLegalPageLayout } from '@/components/ru/RuLegalPageLayout';
import { RU_PD_CONSENT_DOCUMENT } from '@/lib/ru-legal';

export const metadata: Metadata = {
  title: 'Согласие на обработку персональных данных — ASI',
  description: 'Текст отдельного согласия на обработку персональных данных для подключения ASI.',
};

export default function RuPersonalDataConsentPage() {
  return (
    <RuLegalPageLayout title={RU_PD_CONSENT_DOCUMENT.title} intro={RU_PD_CONSENT_DOCUMENT.subtitle}>
      {RU_PD_CONSENT_DOCUMENT.sections.map((section) => (
        <section key={section.heading}>
          <h2>{section.heading}</h2>
          {section.paragraphs.map((paragraph) => <p key={paragraph}>{paragraph}</p>)}
        </section>
      ))}
      <p>
        Подробнее об обработке данных: <Link href="/ru/privacy">Политика конфиденциальности</Link>.
      </p>
    </RuLegalPageLayout>
  );
}
