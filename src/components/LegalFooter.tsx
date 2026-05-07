import Link from 'next/link';
import { productSupportEmail } from '@/config/contact';
import { ruComplianceRoutes } from '@/config/ruCompliance';

export function LegalFooter({ ruSite = false }: { ruSite?: boolean }) {
  const privacyHref = ruSite ? ruComplianceRoutes.privacy : '/privacy';
  const offerHref = ruSite ? ruComplianceRoutes.offer : '/offer';
  const contactsHref = ruSite ? ruComplianceRoutes.contacts : '/contacts';

  return (
    <footer className="bg-slate-950 text-slate-400 py-8 border-t border-slate-900">
      <div className="max-w-5xl mx-auto px-4 sm:px-6 text-sm leading-relaxed">
        <div className="flex flex-col md:flex-row justify-between gap-6">
          <div>
            <p className="font-semibold text-slate-300">ASI Integrations</p>
            <p className="mt-1">{ruSite ? 'Самозанятый исполнитель' : 'Individual service provider'}</p>
          </div>
          <div className="space-y-1">
            <p>
              © {new Date().getFullYear()} ASI Integrations.{' '}
              {ruSite ? 'Все права защищены.' : 'All rights reserved.'}
            </p>
            <div className="flex flex-wrap gap-x-4 gap-y-1">
              <Link href={privacyHref} className="hover:text-slate-200 transition-colors">
                {ruSite ? 'Конфиденциальность' : 'Privacy Policy'}
              </Link>
              <Link href={offerHref} className="hover:text-slate-200 transition-colors">
                {ruSite ? 'Условия' : 'Terms of Service'}
              </Link>
              <Link href={contactsHref} className="hover:text-slate-200 transition-colors">
                {ruSite ? 'Контакты' : 'Contact'}
              </Link>
            </div>
          </div>
          <div className="space-y-1">
            <p>
              Email:{' '}
              <a
                href={`mailto:${productSupportEmail}`}
                className="hover:text-slate-200 transition-colors"
              >
                {productSupportEmail}
              </a>
            </p>
            <p>
              Telegram:{' '}
              <a
                href="https://t.me/ASI_core_bot"
                target="_blank"
                rel="noopener noreferrer"
                className="hover:text-slate-200 transition-colors"
              >
                @ASI_core_bot
              </a>
            </p>
          </div>
        </div>
      </div>
    </footer>
  );
}
