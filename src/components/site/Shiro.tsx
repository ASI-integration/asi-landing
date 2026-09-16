import Image from 'next/image';
import { FlagCircle, type CountryCode } from './FlagCircle';

/**
 * Shiro — the recurring ASI Global brand signature. This is the approved
 * character artwork (cropped from the brand reference), not a redraw.
 * Pass `country` on market pages to pair it with a small circular market
 * identifier, and `signature` to show the "Shiro" script + tagline lockup.
 */
export function Shiro({
  country,
  size = 40,
  signature = false,
  dark = false,
  className = '',
}: {
  country?: CountryCode;
  size?: number;
  signature?: boolean;
  dark?: boolean;
  className?: string;
}) {
  return (
    <span className={`inline-flex items-center gap-2 ${className}`}>
      <span
        className="relative inline-block shrink-0 rounded-full overflow-hidden"
        style={{ width: size, height: size }}
      >
        <Image src="/brand/shiro-badge.png" alt="Shiro, the ASI Global signature" fill sizes={`${size}px`} className="object-cover" />
      </span>
      {signature ? (
        <span className="flex flex-col leading-tight">
          <span className={`font-serif italic text-lg ${dark ? 'text-asi-ivory' : 'text-asi-navy'}`}>Shiro</span>
          <span className={`text-[10px] font-sans uppercase tracking-[0.14em] ${dark ? 'text-asi-ivory/50' : 'text-asi-navy/65'}`}>
            Good stays, brighter tomorrows
          </span>
        </span>
      ) : null}
      {country ? <FlagCircle country={country} size={16} /> : null}
    </span>
  );
}
