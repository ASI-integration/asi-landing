import Link from 'next/link';
import { productSupportEmail } from '@/config/contact';
import { legalConfig } from '@/config/legal';

export const metadata = {
  title: 'Terms of Service — ASI',
  description: 'Terms of service for access to the ASI Integrations platform.',
};

export default function OfferPage() {
  return (
    <div className="min-h-screen bg-white">
      <div className="max-w-2xl mx-auto px-4 sm:px-6 py-16">
        <Link href="/" className="text-slate-500 hover:text-slate-900 text-sm mb-10 inline-block">
          ← Back to home
        </Link>

        <h1 className="text-2xl sm:text-3xl font-bold text-slate-900 tracking-tight">
          Terms of Service
        </h1>
        <p className="mt-3 text-slate-500 text-sm">Effective date: 1 January 2026</p>

        <div className="mt-10 space-y-8 text-slate-700 text-sm leading-relaxed">

          {/* 1. Service provider */}
          <section>
            <h2 className="text-base font-semibold text-slate-900 mb-3">1. Service Provider</h2>
            <div className="p-4 bg-slate-50 rounded-lg border border-slate-200 space-y-1">
              <p>
                <span className="font-medium text-slate-900">Name:</span>{' '}
                {legalConfig.name}
              </p>
              <p>
                <span className="font-medium text-slate-900">Status:</span>{' '}
                {legalConfig.status}
              </p>
              <p>
                <span className="font-medium text-slate-900">Legal inquiries:</span>{' '}
                <a href={`mailto:${legalConfig.email}`} className="text-slate-900 hover:underline">
                  {legalConfig.email}
                </a>
              </p>
              <p>
                <span className="font-medium text-slate-900">Product support:</span>{' '}
                <a href={`mailto:${productSupportEmail}`} className="text-slate-900 hover:underline">
                  {productSupportEmail}
                </a>
              </p>
            </div>
          </section>

          {/* 2. Subject */}
          <section>
            <h2 className="text-base font-semibold text-slate-900 mb-3">2. Subject</h2>
            <p>
              These Terms govern access to{' '}
              <span className="font-medium text-slate-900">ASI Integrations</span>, a SaaS platform
              for automating short-term rental property management, provided under a subscription model.
            </p>
            <p className="mt-3">
              The platform automates listing management, booking processing, guest communication via
              Telegram bot, and payment integrations.
            </p>
            <p className="mt-3">
              By registering an account or completing a subscription payment you accept these Terms in
              full. Acceptance constitutes a binding agreement between you and the service provider.
            </p>
          </section>

          {/* 3. Access */}
          <section>
            <h2 className="text-base font-semibold text-slate-900 mb-3">3. Access</h2>
            <ul className="list-disc pl-5 space-y-1.5">
              <li>
                Access is provisioned within{' '}
                <span className="font-medium text-slate-900">24 hours</span> of payment confirmation.
              </li>
              <li>
                A free trial may be granted after registration. Duration and conditions are stated on
                the pricing page.
              </li>
              <li>
                Access is valid for the paid subscription period (monthly, quarterly, or annual,
                depending on the selected plan).
              </li>
            </ul>
          </section>

          {/* 4. Pricing & payment */}
          <section>
            <h2 className="text-base font-semibold text-slate-900 mb-3">4. Pricing &amp; Payment</h2>
            <p>
              Pricing is published on the website and may be updated with at least 7 calendar days&apos;
              notice to existing subscribers before changes take effect.
            </p>
            <p className="mt-3">
              Payments are processed by our payment provider (Stripe or applicable local processor).
              Accepted methods include major credit/debit cards and other methods available through
              the payment provider.
            </p>
            <p className="mt-3">
              Payment is considered complete upon confirmation from the payment provider.
            </p>
          </section>

          {/* 5. Subscription terms */}
          <section>
            <h2 className="text-base font-semibold text-slate-900 mb-3">5. Subscription Terms</h2>
            <ul className="list-disc pl-5 space-y-1.5">
              <li>Subscriptions are paid in advance for the chosen period.</li>
              <li>Access is suspended at the end of the paid period until the next payment.</li>
              <li>You may cancel at any time; access continues until the end of the paid period.</li>
              <li>
                Refunds for unused periods are not provided, except where the service is unavailable
                due to a fault on the provider&apos;s side for more than 72 consecutive hours.
              </li>
            </ul>
          </section>

          {/* 6. Obligations */}
          <section>
            <h2 className="text-base font-semibold text-slate-900 mb-3">6. Obligations</h2>
            <p className="font-medium text-slate-900">The service provider undertakes to:</p>
            <ul className="mt-2 list-disc pl-5 space-y-1.5">
              <li>Maintain service availability of at least 99% per month (SLA).</li>
              <li>Provide technical support by email within 1 business day.</li>
              <li>Notify users of planned maintenance at least 24 hours in advance.</li>
              <li>Store personal data in accordance with the Privacy Policy.</li>
            </ul>
            <p className="mt-4 font-medium text-slate-900">You undertake to:</p>
            <ul className="mt-2 list-disc pl-5 space-y-1.5">
              <li>Use the service for its intended lawful purpose.</li>
              <li>Not share account access with third parties.</li>
              <li>Pay subscription fees on time.</li>
            </ul>
          </section>

          {/* 7. Limitation of liability */}
          <section>
            <h2 className="text-base font-semibold text-slate-900 mb-3">7. Limitation of Liability</h2>
            <p>
              The service provider is not liable for losses caused by third-party actions (payment
              processors, ISPs, booking platforms) or force-majeure events. Total liability under
              these Terms shall not exceed the amount paid by you for the most recent billing period.
            </p>
          </section>

          {/* 8. Dispute resolution */}
          <section>
            <h2 className="text-base font-semibold text-slate-900 mb-3">8. Dispute Resolution</h2>
            <p>
              Disputes shall be resolved through negotiation in the first instance. If no agreement is
              reached, disputes may be referred to the competent courts. You may also contact us
              directly at{' '}
              <a href={`mailto:${legalConfig.email}`} className="text-slate-900 hover:underline">
                {legalConfig.email}
              </a>
              .
            </p>
          </section>

        </div>

        <div className="mt-12 pt-8 border-t border-slate-200">
          <Link href="/privacy" className="text-slate-500 hover:text-slate-900 text-sm">
            Privacy Policy →
          </Link>
        </div>
      </div>
    </div>
  );
}
