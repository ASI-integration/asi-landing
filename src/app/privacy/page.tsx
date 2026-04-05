import Link from 'next/link';
import { productSupportEmail } from '@/config/contact';
import { legalConfig } from '@/config/legal';

export const metadata = {
  title: 'Privacy Policy — ASI',
  description: 'Privacy and personal data processing policy for ASI Integrations.',
};

export default function PrivacyPage() {
  return (
    <div className="min-h-screen bg-white">
      <div className="max-w-2xl mx-auto px-4 sm:px-6 py-16">
        <Link href="/" className="text-slate-500 hover:text-slate-900 text-sm mb-10 inline-block">
          ← Back to home
        </Link>

        <h1 className="text-2xl sm:text-3xl font-bold text-slate-900 tracking-tight">
          Privacy Policy
        </h1>
        <p className="mt-3 text-slate-500 text-sm">Effective date: 1 January 2026</p>

        <div className="mt-10 space-y-8 text-slate-700 text-sm leading-relaxed">

          {/* 1. Controller */}
          <section>
            <h2 className="text-base font-semibold text-slate-900 mb-3">
              1. Data Controller
            </h2>
            <p>
              This Privacy Policy applies to the ASI Integrations service and its associated websites.
            </p>
            <div className="mt-3 p-4 bg-slate-50 rounded-lg border border-slate-200 space-y-1">
              <p>
                <span className="font-medium text-slate-900">Controller:</span>{' '}
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

          {/* 2. Data we collect */}
          <section>
            <h2 className="text-base font-semibold text-slate-900 mb-3">
              2. Data We Collect
            </h2>
            <p>
              We collect only the data necessary to provide the service:
            </p>
            <ul className="mt-3 list-disc pl-5 space-y-1.5">
              <li>First and last name (for account identification).</li>
              <li>Email address (for login and communication).</li>
              <li>Phone number and/or Telegram handle (for operational contact, optional).</li>
              <li>Property details (address, type, count — for service configuration).</li>
              <li>Payment data — processed exclusively by our payment provider; we do not store card details.</li>
            </ul>
          </section>

          {/* 3. Purpose */}
          <section>
            <h2 className="text-base font-semibold text-slate-900 mb-3">
              3. Purpose of Processing
            </h2>
            <ul className="list-disc pl-5 space-y-1.5">
              <li>User identification and provisioning of access to the ASI service.</li>
              <li>Account and property configuration in the system.</li>
              <li>Communication with users on technical, billing, and operational matters.</li>
              <li>Payment processing and invoicing via the payment provider.</li>
              <li>Fulfilling obligations under the Terms of Service.</li>
              <li>Compliance with applicable laws.</li>
            </ul>
          </section>

          {/* 4. Third parties */}
          <section>
            <h2 className="text-base font-semibold text-slate-900 mb-3">
              4. Sharing with Third Parties
            </h2>
            <p>
              We do not sell or share personal data with third parties, except:
            </p>
            <ul className="mt-3 list-disc pl-5 space-y-1.5">
              <li>
                <span className="font-medium text-slate-900">Payment processor</span> — data shared
                strictly to the extent necessary to process a transaction.
              </li>
              <li>
                Where required by applicable law or in response to a lawful request by a public authority.
              </li>
            </ul>
          </section>

          {/* 5. Storage & security */}
          <section>
            <h2 className="text-base font-semibold text-slate-900 mb-3">
              5. Storage &amp; Security
            </h2>
            <p>
              Data is stored on secured servers using encryption (TLS/HTTPS). Personal data is
              retained for the lifetime of the account and for 3 years after deletion, or until
              consent is withdrawn by the user.
            </p>
          </section>

          {/* 6. Your rights */}
          <section>
            <h2 className="text-base font-semibold text-slate-900 mb-3">
              6. Your Rights
            </h2>
            <p>You have the right to:</p>
            <ul className="mt-3 list-disc pl-5 space-y-1.5">
              <li>Access the personal data we hold about you.</li>
              <li>Request correction of inaccurate data.</li>
              <li>Request deletion of your data ("right to be forgotten").</li>
              <li>Withdraw consent to data processing at any time.</li>
            </ul>
            <p className="mt-3">
              To exercise your rights, send a request to{' '}
              <a href={`mailto:${legalConfig.email}`} className="text-slate-900 hover:underline">
                {legalConfig.email}
              </a>
              .
            </p>
          </section>

          {/* 7. Cookies */}
          <section>
            <h2 className="text-base font-semibold text-slate-900 mb-3">7. Cookies</h2>
            <p>
              The site uses technical cookies required for authentication and saving user preferences.
              No analytics or advertising cookies are used.
            </p>
          </section>

          {/* 8. Policy updates */}
          <section>
            <h2 className="text-base font-semibold text-slate-900 mb-3">
              8. Policy Updates
            </h2>
            <p>
              We may update this Privacy Policy from time to time. The current version is always
              available at <span className="font-medium text-slate-900">guestautopilot.com/privacy</span>.
              Continued use of the service after an update constitutes acceptance of the revised policy.
            </p>
          </section>

        </div>

        <div className="mt-12 pt-8 border-t border-slate-200">
          <Link href="/offer" className="text-slate-500 hover:text-slate-900 text-sm">
            Terms of Service →
          </Link>
        </div>
      </div>
    </div>
  );
}
