import { Hero } from '@/components/Hero';
import { Problem } from '@/components/Problem';
import { Solution } from '@/components/Solution';
import { Features } from '@/components/Features';
import { HowItWorks } from '@/components/HowItWorks';
import { UseCases } from '@/components/UseCases';
import { TrustSection } from '@/components/TrustSection';
import { Pricing } from '@/components/Pricing';
import { FAQ } from '@/components/FAQ';
import { DemoSection } from '@/components/DemoSection';
import { FinalCTA } from '@/components/FinalCTA';
import { Header } from '@/components/Header';
import { Footer } from '@/components/Footer';

export default function Home() {
  return (
    <div className="min-h-screen bg-white">
      <Header />
      <main>
        <Hero />
        <Problem />
        <Solution />
        <Features />
        <HowItWorks />
        <UseCases />
        <TrustSection />
        <Pricing />
        <FAQ />
        <DemoSection />
        <FinalCTA />
      </main>
      <Footer />
    </div>
  );
}
