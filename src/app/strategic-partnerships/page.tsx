import { StrategicLanding } from '@/components/StrategicLanding';
import { Header } from '@/components/Header';
import { Footer } from '@/components/Footer';
import type { Metadata } from 'next';

export const metadata: Metadata = {
  title: 'Strategic Participation | ASI',
  description: 'Early access to the AI platform for short-term rental operations automation.',
};

export default function StrategicPartnershipsPage() {
  return (
    <div className="min-h-screen bg-white">
      <Header />
      <main>
        <StrategicLanding />
      </main>
      <Footer />
    </div>
  );
}
