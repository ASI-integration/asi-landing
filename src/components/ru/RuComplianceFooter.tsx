/** RU compliance footer — guestautopilot navy visual shell; RU merchant content only. */
import Link from 'next/link';
import { BrandShiro } from '@/components/brand';
import { productSupportEmail } from '@/config/contact';
import { ruCompliance, ruComplianceRoutes } from '@/config/ruCompliance';
import { telegramSupportBotUrl } from '@/config/telegramBots';
import { asiBrandLayout } from '@/config/brand/tokens';

type Tone = 'theme' | 'light' | 'dark';
type Variant = 'full' | 'compact';

export function RuComplianceFooter({
  tone: _tone = 'theme',
  variant = 'full',
}: {
  tone?: Tone;
  /** Compact homepage footer: one block with required journey copy + merchant identity. */
  variant?: Variant;
}) {
  // Tone kept for call-site compatibility; shared brand footer is navy.
  void _tone;

  if (variant === 'compact') {
    return (
      // Root is a div so page shells can own the single footer landmark.
      <div className="bg-asi-navy text-asi-ivory/80 py-12 sm:py-14 px-5 sm:px-8">
        <div className={`${asiBrandLayout.contentMaxClass} mx-auto flex flex-col gap-8`}>
          <div className="grid gap-8 lg:grid-cols-[1.2fr,0.8fr]">
            <div>
              <p className="font-serif text-lg text-asi-ivory tracking-tight">ASI Global © 2026.</p>
              <p className="mt-3 text-sm leading-relaxed text-asi-ivory/65 max-w-md">
                ASI сама ведёт рутину объектов посуточной аренды.
              </p>
              <div className="mt-5 space-y-2 text-sm text-asi-ivory/80">
                <p>
                  Telegram:{' '}
                  <a
                    href={telegramSupportBotUrl}
                    target="_blank"
                    rel="noopener noreferrer"
                    className="underline underline-offset-2 hover:text-asi-ivory"
                  >
                    @ASI_Support_Bot
                  </a>
                </p>
                <p>
                  Email:{' '}
                  <a
                    href={`mailto:${productSupportEmail}`}
                    className="underline underline-offset-2 hover:text-asi-ivory"
                  >
                    support@asi-global.ru
                  </a>
                </p>
              </div>
            </div>
            <nav className="flex flex-col gap-2.5 text-sm" aria-label="Юридические ссылки">
              <Link href={ruComplianceRoutes.offer} className="hover:text-asi-ivory transition-colors">
                Оферта
              </Link>
              <Link
                href={ruComplianceRoutes.privacy}
                className="hover:text-asi-ivory transition-colors"
              >
                Политика конфиденциальности
              </Link>
              <Link
                href={ruComplianceRoutes.contacts}
                className="hover:text-asi-ivory transition-colors"
              >
                Контакты
              </Link>
            </nav>
          </div>
          <div className="pt-6 border-t border-asi-ivory/15 flex flex-col sm:flex-row sm:items-end gap-4 justify-between">
            <div className="text-xs text-asi-ivory/55 leading-relaxed">
              <p>
                Самозанятый: {ruCompliance.fullName} · ИНН: {ruCompliance.inn}
              </p>
              <p className="mt-1">{ruCompliance.address}</p>
            </div>
            <BrandShiro size={36} signature dark />
          </div>
        </div>
      </div>
    );
  }

  return (
    // Root is a div so page shells can own the single footer landmark.
    <div className="bg-asi-navy text-asi-ivory/80 py-12 sm:py-14 px-5 sm:px-8">
      <div className={`${asiBrandLayout.contentMaxClass} mx-auto flex flex-col gap-10`}>
        <div className="flex flex-col sm:flex-row justify-between gap-10 sm:gap-6">
          <div className="max-w-sm">
            <p className="font-serif text-lg text-asi-ivory tracking-tight">ASI</p>
            <p className="mt-3 text-sm leading-relaxed text-asi-ivory/60">
              Операции посуточной аренды на автопилоте. Человек — только для исключений.
            </p>
            <p className="mt-4 text-sm text-asi-ivory/75">
              <a
                href={`mailto:${ruCompliance.email}`}
                className="underline underline-offset-2 hover:text-asi-ivory"
              >
                {ruCompliance.email}
              </a>
              {' · '}
              <a
                href={`tel:${ruCompliance.phoneTel}`}
                className="underline underline-offset-2 hover:text-asi-ivory"
              >
                {ruCompliance.phone}
              </a>
            </p>
          </div>

          <div className="grid grid-cols-1 sm:grid-cols-2 gap-8 text-sm">
            <div className="flex flex-col gap-2.5">
              <span className="text-xs font-semibold uppercase tracking-[0.18em] text-asi-gold-soft mb-1">
                Документы
              </span>
              <Link href={ruComplianceRoutes.payment} className="hover:text-asi-ivory transition-colors">
                Оплата
              </Link>
              <Link href={ruComplianceRoutes.refund} className="hover:text-asi-ivory transition-colors">
                Возврат
              </Link>
              <Link href={ruComplianceRoutes.privacy} className="hover:text-asi-ivory transition-colors">
                Политика данных
              </Link>
              <Link href={ruComplianceRoutes.offer} className="hover:text-asi-ivory transition-colors">
                Оферта
              </Link>
              <Link href={ruComplianceRoutes.contacts} className="hover:text-asi-ivory transition-colors">
                Контакты
              </Link>
            </div>
            <div className="flex flex-col gap-2.5">
              <span className="text-xs font-semibold uppercase tracking-[0.18em] text-asi-gold-soft mb-1">
                Исполнитель
              </span>
              <p className="text-asi-ivory/80 leading-relaxed">
                Самозанятый: {ruCompliance.fullName}
                <br />
                ИНН: {ruCompliance.inn}
                <br />
                {ruCompliance.address}
              </p>
            </div>
          </div>
        </div>

        <div className="pt-8 border-t border-asi-ivory/15 flex flex-col sm:flex-row sm:items-center gap-5">
          <BrandShiro size={40} signature dark />
          <p className="text-xs text-asi-ivory/50 leading-relaxed max-w-2xl">
            Shiro — официальная подпись бренда ASI. Локальные адаптации сохраняют ту же визуальную
            систему; юридические и контактные данные рынка остаются отдельными.
          </p>
        </div>
      </div>
    </div>
  );
}
