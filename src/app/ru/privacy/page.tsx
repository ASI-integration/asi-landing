import type { Metadata } from 'next';
import { RuLegalPageLayout } from '@/components/ru/RuLegalPageLayout';
import { ruCompliance } from '@/config/ruCompliance';
import { RU_PUBLIC_ORIGIN } from '@/config/publicOrigins';

export const metadata: Metadata = {
  title: 'Политика обработки персональных данных — ASI',
  description: 'Порядок обработки и защиты персональных данных пользователей.',
  alternates: { canonical: `${RU_PUBLIC_ORIGIN}/privacy` },
};

export default function RuPrivacyPage() {
  return (
    <RuLegalPageLayout title="Политика обработки персональных данных">
      <p>
        Настоящая Политика обработки персональных данных определяет порядок обработки и защиты персональных данных
        пользователей сайта.
      </p>

      <section className="space-y-3">
        <h2 className="text-base font-semibold text-[var(--t-text)]">1. Оператор персональных данных</h2>
        <p>ФИО: {ruCompliance.fullName}</p>
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
      </section>

      <section className="space-y-3">
        <h2 className="text-base font-semibold text-[var(--t-text)]">2. Какие данные могут обрабатываться</h2>
        <p>Мы можем обрабатывать следующие данные пользователя:</p>
        <ul className="list-disc pl-5 space-y-2">
          <li>имя</li>
          <li>адрес электронной почты</li>
          <li>номер телефона</li>
          <li>платёжные и технические данные в объёме, необходимом для оказания услуг и работы сайта</li>
          <li>иные данные, добровольно предоставленные пользователем через формы сайта</li>
        </ul>
      </section>

      <section className="space-y-3">
        <h2 className="text-base font-semibold text-[var(--t-text)]">3. Цели обработки данных</h2>
        <p>Персональные данные обрабатываются в целях:</p>
        <ul className="list-disc pl-5 space-y-2">
          <li>регистрации и идентификации пользователя</li>
          <li>предоставления доступа к сервису</li>
          <li>обработки обращений пользователя</li>
          <li>исполнения обязательств по оплате и возвратам</li>
          <li>улучшения работы сайта и сервиса</li>
          <li>соблюдения требований законодательства РФ</li>
        </ul>
      </section>

      <section className="space-y-3">
        <h2 className="text-base font-semibold text-[var(--t-text)]">4. Правовые основания обработки</h2>
        <p>Обработка персональных данных осуществляется на основании:</p>
        <ul className="list-disc pl-5 space-y-2">
          <li>согласия субъекта персональных данных</li>
          <li>необходимости исполнения договора или заключения договора по инициативе пользователя</li>
          <li>требований законодательства Российской Федерации</li>
        </ul>
      </section>

      <section className="space-y-3">
        <h2 className="text-base font-semibold text-[var(--t-text)]">5. Передача третьим лицам</h2>
        <p>
          Персональные данные могут передаваться третьим лицам только в объёме, необходимом для обработки платежей,
          обеспечения работы сайта, исполнения обязательств перед пользователем, а также в случаях, предусмотренных
          законодательством РФ.
        </p>
      </section>

      <section className="space-y-3">
        <h2 className="text-base font-semibold text-[var(--t-text)]">6. Срок хранения данных</h2>
        <p>
          Персональные данные хранятся не дольше, чем это необходимо для целей обработки, если иной срок не установлен
          законодательством Российской Федерации.
        </p>
      </section>

      <section className="space-y-3">
        <h2 className="text-base font-semibold text-[var(--t-text)]">7. Права пользователя</h2>
        <p>
          Пользователь вправе запросить уточнение, обновление, удаление своих персональных данных, а также отозвать
          согласие на их обработку, направив обращение по адресу:{' '}
          <a
            href={`mailto:${ruCompliance.email}`}
            className="text-[var(--t-text)] underline underline-offset-2 decoration-[var(--t-border)] hover:decoration-[var(--t-text)]"
          >
            {ruCompliance.email}
          </a>
        </p>
      </section>

      <section className="space-y-3">
        <h2 className="text-base font-semibold text-[var(--t-text)]">8. Защита данных</h2>
        <p>
          Мы принимаем разумные организационные и технические меры для защиты персональных данных от неправомерного
          доступа, утраты, изменения, раскрытия или уничтожения.
        </p>
      </section>
    </RuLegalPageLayout>
  );
}
