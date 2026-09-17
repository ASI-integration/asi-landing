import { StrategicLanding } from '@/components/StrategicLanding';
import { Header } from '@/components/Header';
import { Footer } from '@/components/Footer';
import type { Metadata } from 'next';
import { getIsRuHost } from '@/lib/getIsRuHost';
import { GUEST_AUTOPILOT_ORIGIN } from '@/config/publicOrigins';

export const metadata: Metadata = {
  title: 'Strategic Participation | ASI',
  description: 'Early access to the AI platform for short-term rental operations automation.',
  alternates: { canonical: `${GUEST_AUTOPILOT_ORIGIN}/strategic-partnerships` },
};

export default async function StrategicPartnershipsPage() {
  const isRuHost = await getIsRuHost();
  return (
    <div className="min-h-screen bg-white">
      <Header isRuHost={isRuHost} />
      <main>
        <StrategicLanding />
      </main>
      <Footer />
    </div>
  );
}
