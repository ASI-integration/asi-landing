export type CountryCode = 'jp' | 'hk' | 'tw' | 'sg' | 'kr' | 'ae';

const FLAG_EMOJI: Record<CountryCode, string> = {
  jp: '🇯🇵',
  hk: '🇭🇰',
  tw: '🇹🇼',
  sg: '🇸🇬',
  kr: '🇰🇷',
  ae: '🇦🇪',
};

const FLAG_NAME: Record<CountryCode, string> = {
  jp: 'Japan',
  hk: 'Hong Kong',
  tw: 'Taiwan',
  sg: 'Singapore',
  kr: 'Korea',
  ae: 'UAE',
};

export function FlagCircle({ country, size = 20 }: { country: CountryCode; size?: number }) {
  return (
    <span
      className="inline-flex items-center justify-center rounded-full border border-asi-border bg-asi-paper shrink-0"
      style={{ width: size, height: size, fontSize: size * 0.6, lineHeight: 1 }}
      role="img"
      aria-label={`${FLAG_NAME[country]} flag`}
      title={FLAG_NAME[country]}
    >
      {FLAG_EMOJI[country]}
    </span>
  );
}
