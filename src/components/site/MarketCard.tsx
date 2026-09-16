import Link from 'next/link';
import { FlagCircle, type CountryCode } from './FlagCircle';
import { Shiro } from './Shiro';

export function MarketCard({
  country,
  name,
  line,
  href,
  status,
}: {
  country: CountryCode;
  name: string;
  line: string;
  href?: string;
  status: 'active' | 'coming-next';
}) {
  const content = (
    <div className="group h-full flex flex-col justify-between p-6 sm:p-7 bg-asi-paper border border-asi-border rounded-sm transition-colors hover:border-asi-gold">
      <div>
        <div className="flex items-center justify-between mb-6">
          <Shiro country={country} size={26} className="text-asi-navy" />
          {status === 'active' ? (
            <span className="text-[11px] font-sans font-semibold uppercase tracking-[0.16em] text-asi-gold">Active</span>
          ) : (
            <span className="text-[11px] font-sans font-semibold uppercase tracking-[0.16em] text-asi-navy/40">Coming next</span>
          )}
        </div>
        <h3 className="font-serif text-2xl text-asi-navy">{name}</h3>
        <p className="mt-2 text-sm text-asi-navy/65 leading-relaxed">{line}</p>
      </div>
      {href ? (
        <span className="mt-6 inline-flex items-center gap-1.5 text-sm font-sans font-semibold text-asi-navy group-hover:gap-2.5 transition-all">
          Explore <FlagCircle country={country} size={14} />
        </span>
      ) : (
        <span className="mt-6 text-sm text-asi-navy/40">Details soon</span>
      )}
    </div>
  );

  if (!href) return content;
  return (
    <Link href={href} className="block h-full">
      {content}
    </Link>
  );
}
