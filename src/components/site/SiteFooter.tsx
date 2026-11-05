import Link from 'next/link';
import { LogoMark } from './LogoMark';
import { Shiro } from './Shiro';

export function SiteFooter() {
  return (
    <footer className="bg-asi-ivory text-asi-navy/80 border-t border-asi-border py-14 px-5 sm:px-8">
      <div className="max-w-6xl mx-auto">
        <div className="flex flex-col sm:flex-row justify-between gap-10 sm:gap-6">
          <div className="max-w-sm">
            <div className="flex items-center gap-3 text-asi-navy">
              <LogoMark size={24} />
              <span className="font-serif text-lg">ASI Global</span>
            </div>
            <p className="mt-4 text-sm leading-relaxed text-asi-navy/60">
              Private modular cabins inside existing commercial buildings.
              Intelligent operations designed for worldwide scale.
            </p>
          </div>
          <nav aria-label="Footer" className="grid grid-cols-2 sm:grid-cols-3 gap-8 text-sm">
            <div className="flex flex-col gap-2.5">
              <span className="text-xs font-semibold uppercase tracking-[0.18em] text-asi-gold-text mb-1">Explore</span>
              <Link href="/#cabins" className="hover:text-asi-gold-text transition-colors">ASI Cabins</Link>
              <Link href="/#platform" className="hover:text-asi-gold-text transition-colors">ASI Intelligence</Link>
            </div>
            <div className="flex flex-col gap-2.5">
              <span className="text-xs font-semibold uppercase tracking-[0.18em] text-asi-gold-text mb-1">Worldwide</span>
              <Link href="/#global" className="hover:text-asi-gold-text transition-colors">Global scaling</Link>
              <Link href="/#partner" className="hover:text-asi-gold-text transition-colors">Partnership</Link>
            </div>
            <div className="flex flex-col gap-2.5">
              <span className="text-xs font-semibold uppercase tracking-[0.18em] text-asi-gold-text mb-1">Company</span>
              <Link href="/#about" className="hover:text-asi-gold-text transition-colors">About ASI</Link>
              <Link href="/rental-autopilot" className="hover:text-asi-gold-text transition-colors">Rental Autopilot</Link>
            </div>
          </nav>
        </div>
        <div className="mt-12 pt-8 border-t border-asi-border flex flex-col sm:flex-row sm:items-center gap-5">
          <Shiro size={40} signature />
          <p className="text-xs text-asi-navy/50 leading-relaxed max-w-2xl">
            Shiro is the ASI Global brand signature. One identity for partners and guests worldwide.
          </p>
        </div>
      </div>
    </footer>
  );
}
