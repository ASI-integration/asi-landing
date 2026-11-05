import Link from 'next/link';
import { LogoMark } from './LogoMark';
import { Shiro } from './Shiro';

export function SiteFooter() {
  return (
    <footer className="bg-asi-navy text-asi-ivory/80 py-14 px-5 sm:px-8">
      <div className="max-w-6xl mx-auto">
        <div className="flex flex-col sm:flex-row justify-between gap-10 sm:gap-6">
          <div className="max-w-sm">
            <div className="flex items-center gap-3 text-asi-ivory">
              <LogoMark size={24} />
              <span className="font-serif text-lg">ASI Global</span>
            </div>
            <p className="mt-4 text-sm leading-relaxed text-asi-ivory/60">
              Autonomous operations for physical businesses.
            </p>
          </div>

          <div className="grid grid-cols-2 sm:grid-cols-4 gap-8 text-sm">
            <div className="flex flex-col gap-2.5">
              <span className="text-xs font-semibold uppercase tracking-[0.18em] text-asi-gold-soft mb-1">ASI Global</span>
              <Link href="/#intelligence" className="hover:text-asi-ivory transition-colors">Autonomous Operations</Link>
              <Link href="/#cabins" className="hover:text-asi-ivory transition-colors">ASI Cabins</Link>
            </div>
            <div className="flex flex-col gap-2.5">
              <span className="text-xs font-semibold uppercase tracking-[0.18em] text-asi-gold-soft mb-1">Explore</span>
              <Link href="/#global" className="hover:text-asi-ivory transition-colors">Worldwide model</Link>
              <Link href="/#cabins" className="hover:text-asi-ivory transition-colors">Cabin concept</Link>
              <Link href="/strategic-partnerships" className="hover:text-asi-ivory transition-colors">Strategic partners</Link>
            </div>
            <div className="flex flex-col gap-2.5">
              <span className="text-xs font-semibold uppercase tracking-[0.18em] text-asi-gold-soft mb-1">Company</span>
              <Link href="/#about" className="hover:text-asi-ivory transition-colors">About</Link>
              <Link href="/#partner" className="hover:text-asi-ivory transition-colors">Partner with ASI</Link>
              <Link href="/rental-autopilot" className="hover:text-asi-ivory transition-colors">Rental Autopilot product</Link>
            </div>
          </div>
        </div>

        <div className="mt-12 pt-8 border-t border-asi-ivory/15 flex flex-col sm:flex-row sm:items-center gap-5">
          <Shiro size={40} signature dark />
          <p className="text-xs text-asi-ivory/50 leading-relaxed max-w-2xl">
            ASI Global · One modular hospitality concept designed for suitable locations around the world.
          </p>
        </div>
      </div>
    </footer>
  );
}
