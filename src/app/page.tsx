import { Hero } from '@/components/Hero';
import { DemoSection } from '@/components/DemoSection';
import { Problem } from '@/components/Problem';
import { Solution } from '@/components/Solution';
import { Features } from '@/components/Features';
import { HowItWorks } from '@/components/HowItWorks';
import { ArchitectureSection } from '@/components/ArchitectureSection';
import { SocialProof } from '@/components/SocialProof';
import { Pricing } from '@/components/Pricing';
import { FAQ } from '@/components/FAQ';
import { FinalCTA } from '@/components/FinalCTA';
import { Header } from '@/components/Header';
import { Footer } from '@/components/Footer';

export default function Home() {
  return (
    <div className="min-h-screen bg-white">
      <Header />
      <main>
        <Hero />
        <DemoSection />
        <Problem />
        <Solution />
        <Features />
        <HowItWorks />
        <ArchitectureSection />
        <SocialProof />
        <Pricing />
        <FAQ />
        <FinalCTA />
      </main>
      <Footer />
    </div>
  );
}
