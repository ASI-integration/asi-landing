'use client';

export function PrintPageButton() {
  return (
    <button
      type="button"
      onClick={() => window.print()}
      className="border border-asi-navy px-4 py-2 text-sm font-semibold text-asi-navy hover:bg-asi-navy hover:text-asi-ivory"
    >
      Версия для печати
    </button>
  );
}
