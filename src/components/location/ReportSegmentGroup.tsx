export function ReportSegmentGroup({
  id,
  badgeRu,
  introRu,
  children,
}: {
  id?: string;
  badgeRu: string;
  introRu: string;
  children: React.ReactNode;
}) {
  return (
    <div id={id} className="space-y-6 scroll-mt-24">
      <div className="rounded-2xl border border-slate-800/70 bg-slate-950/40 px-6 py-5 sm:px-8">
        <p className="text-[11px] uppercase tracking-[0.22em] text-indigo-300/90">{badgeRu}</p>
        <p className="mt-3 max-w-3xl text-sm leading-relaxed text-slate-300">{introRu}</p>
      </div>
      {children}
    </div>
  );
}
