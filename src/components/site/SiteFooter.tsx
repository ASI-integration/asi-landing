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
              ASI Cabins: private modular rooms, five accommodation formats and one intelligent operating platform.
              Development and first-pilot preparation are underway.
            </p>
          </div>

          <div className="grid grid-cols-2 sm:grid-cols-3 gap-8 text-sm">
            <div className="flex flex-col gap-2.5">
              <span className="text-xs font-semibold uppercase tracking-[0.18em] text-asi-gold-soft mb-1">Product</span>
              <Link href="/cabins" className="hover:text-asi-ivory transition-colors">ASI Cabins</Link>
              <Link href="/#concept" className="hover:text-asi-ivory transition-colors">The concept</Link>
              <Link href="/#formats" className="hover:text-asi-ivory transition-colors">Five formats</Link>
            </div>

            <div className="flex flex-col gap-2.5">
              <span className="text-xs font-semibold uppercase tracking-[0.18em] text-asi-gold-soft mb-1">System</span>
              <Link href="/#how-it-works" className="hover:text-asi-ivory transition-colors">How it works</Link>
              <Link href="/#platform" className="hover:text-asi-ivory transition-colors">ASI platform</Link>
              <Link href="/#pilot" className="hover:text-asi-ivory transition-colors">Current stage</Link>
            </div>

            <div className="flex flex-col gap-2.5">
              <span className="text-xs font-semibold uppercase tracking-[0.18em] text-asi-gold-soft mb-1">Partnership</span>
              <Link href="/#partners" className="hover:text-asi-ivory transition-colors">Partner with ASI</Link>
              <a
                href="mailto:project.ayfaar@gmail.com?subject=ASI%20Cabins%20partnership"
                className="hover:text-asi-ivory transition-colors"
              >
                Contact ASI Global
              </a>
            </div>
          </div>
        </div>

        <div className="mt-12 pt-8 border-t border-asi-ivory/15 flex flex-col sm:flex-row sm:items-center gap-5">
          <Shiro size={40} signature dark />
          <p className="text-xs text-asi-ivory/50 leading-relaxed max-w-2xl">
            Shiro is the recurring brand signature of ASI Global. ASI Cabins remains a development-stage concept;
            illustrations are not photographs of operating ASI locations.
          </p>
        </div>
      </div>
    </footer>
  );
}
