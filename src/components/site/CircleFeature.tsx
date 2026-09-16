const ICONS = {
  bed: (
    <path d="M3 17v-6a2 2 0 0 1 2-2h4a2 2 0 0 1 2 2v2M3 17v3M3 17h18M21 17v3M11 11h4a2 2 0 0 1 2 2v2" />
  ),
  gear: (
    <>
      <circle cx="12" cy="12" r="3" />
      <path d="M12 4v2M12 18v2M4 12h2M18 12h2M6.3 6.3l1.4 1.4M16.3 16.3l1.4 1.4M17.7 6.3l-1.4 1.4M7.7 16.3l-1.4 1.4" />
    </>
  ),
  chart: <path d="M5 19V10M12 19V5M19 19v-6" />,
} as const;

export type FeatureIcon = keyof typeof ICONS;

function Icon({ name }: { name: FeatureIcon }) {
  return (
    <svg width="20" height="20" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="1.6" strokeLinecap="round" strokeLinejoin="round" aria-hidden="true">
      {ICONS[name]}
    </svg>
  );
}

export function CircleFeature({
  icon,
  title,
  description,
}: {
  icon: FeatureIcon;
  title: string;
  description: string;
}) {
  return (
    <div className="flex items-start gap-4">
      <span className="flex items-center justify-center w-11 h-11 rounded-full border border-asi-gold text-asi-gold shrink-0">
        <Icon name={icon} />
      </span>
      <div>
        <p className="font-serif text-base text-asi-navy leading-snug">{title}</p>
        <p className="mt-1 text-sm text-asi-navy/55 leading-relaxed">{description}</p>
      </div>
    </div>
  );
}
