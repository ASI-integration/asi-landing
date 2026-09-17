/** RU compliance footer — guestautopilot navy visual shell; RU merchant content only. */
import Link from 'next/link';
import { BrandShiro } from '@/components/brand';
import { ruCompliance, ruComplianceRoutes } from '@/config/ruCompliance';
import { asiBrandLayout } from '@/config/brand/tokens';

type Tone = 'theme' | 'light' | 'dark';

export function RuComplianceFooter({ tone: _tone = 'theme' }: { tone?: Tone }) {
  // Tone kept for call-site compatibility; shared brand footer is navy.
  void _tone;

  return (
    <footer className="bg-asi-navy text-asi-ivory/80 py-12 sm:py-14 px-5 sm:px-8">
      <div className={`${asiBrandLayout.contentMaxClass} mx-auto flex flex-col gap-10`}>
        <div className="flex flex-col sm:flex-row justify-between gap-10 sm:gap-6">
          <div className="max-w-sm">
            <p className="font-serif text-lg text-asi-ivory tracking-tight">ASI</p>
            <p className="mt-3 text-sm leading-relaxed text-asi-ivory/60">
              AI-ответы гостям для посуточной аренды. Закрытый пилот — один объект, один месяц.
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
                Конфиденциальность
              </Link>
              <Link href={ruComplianceRoutes.offer} className="hover:text-asi-ivory transition-colors">
                Условия
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
    </footer>
  );
}
