import Link from 'next/link';

export function MediaCard({
  label,
  title,
  action,
  href,
}: {
  label: string;
  title: string;
  action: 'view' | 'coming-soon';
  href?: string;
}) {
  const inner = (
    <div className="group flex flex-col justify-between h-full p-6 sm:p-7 bg-asi-paper border border-asi-border rounded-sm transition-colors hover:border-asi-gold">
      <div>
        <span className="text-[11px] font-sans font-semibold uppercase tracking-[0.18em] text-asi-gold-text">{label}</span>
        <h3 className="mt-3 font-serif text-xl text-asi-navy">{title}</h3>
      </div>
      {action === 'view' ? (
        <span className="mt-6 inline-flex items-center gap-1.5 text-sm font-sans font-semibold text-asi-navy group-hover:gap-2.5 transition-all">
          View →
        </span>
      ) : (
        <span className="mt-6 text-sm text-asi-navy/60 font-sans">Coming soon</span>
      )}
    </div>
  );

  if (action === 'view' && href) {
    return (
      <Link href={href} className="block h-full">
        {inner}
      </Link>
    );
  }
  return inner;
}
