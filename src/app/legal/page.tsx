import Link from 'next/link';
import { productSupportEmail } from '@/config/contact';
import { legalConfig } from '@/config/legal';

export const metadata = {
  title: 'Legal Information — ASI',
  description: 'Legal information and terms of use for the ASI service.',
};

export default function LegalPage() {
  return (
    <div className="min-h-screen bg-white">
      <div className="max-w-2xl mx-auto px-4 sm:px-6 py-16">
        <Link href="/" className="text-slate-600 hover:text-slate-900 text-sm mb-8 inline-block">
          ← Back to home
        </Link>

        <h1 className="text-2xl font-bold text-slate-900 tracking-tight">
          Legal Information
        </h1>

        <div className="mt-8 space-y-6 text-slate-700 text-sm leading-relaxed">
          <section>
            <h2 className="font-semibold text-slate-900 mb-2">Service provider:</h2>
            <p>{legalConfig.name}</p>
            <p>
              Legal &amp; official inquiries:{' '}
              <a href={`mailto:${legalConfig.email}`} className="text-slate-900 hover:underline">
                {legalConfig.email}
              </a>
            </p>
            <p>
              ASI product support:{' '}
              <a href={`mailto:${productSupportEmail}`} className="text-slate-900 hover:underline">
                {productSupportEmail}
              </a>
            </p>
            <p>{legalConfig.status}</p>
          </section>

          <section>
            <h2 className="font-semibold text-slate-900 mb-2">Service description:</h2>
            <p>
              ASI is a SaaS platform for automating short-term rental property management.
              The service provides tools for booking automation, guest communication, and analytics.
            </p>
          </section>

          <section>
            <h2 className="font-semibold text-slate-900 mb-2">Terms of service:</h2>
            <ul className="list-disc pl-5 space-y-2">
              <li>Subscription is billed monthly.</li>
              <li>Free trial period — 14 days.</li>
              <li>Cancellation is available at any time.</li>
              <li>Refunds are not provided after the paid period begins.</li>
            </ul>
          </section>
        </div>
      </div>
    </div>
  );
}
