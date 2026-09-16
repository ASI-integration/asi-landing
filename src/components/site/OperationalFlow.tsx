const STEPS = ['Booking', 'Payment', 'Access', 'Messages', 'Cleaning', 'Maintenance', 'Pricing', 'Exception', 'Human'];

export function OperationalFlow({ dark = false }: { dark?: boolean }) {
  return (
    <ol className="flex flex-wrap items-center gap-x-2 gap-y-3 sm:gap-x-3">
      {STEPS.map((step, i) => {
        const isHuman = step === 'Human';
        const isException = step === 'Exception';
        return (
          <li key={step} className="flex items-center gap-x-2 sm:gap-x-3">
            <span
              className={`px-3.5 py-2 text-xs sm:text-sm font-sans font-medium rounded-sm border whitespace-nowrap ${
                isHuman
                  ? 'bg-asi-gold text-asi-navy border-asi-gold'
                  : isException
                    ? `border-asi-gold ${dark ? 'text-asi-gold-soft' : 'text-asi-gold'}`
                    : dark
                      ? 'border-asi-ivory/25 text-asi-ivory/80'
                      : 'border-asi-border text-asi-navy/75'
              }`}
            >
              {step}
            </span>
            {i < STEPS.length - 1 ? (
              <span aria-hidden="true" className={dark ? 'text-asi-ivory/30' : 'text-asi-navy/25'}>
                →
              </span>
            ) : null}
          </li>
        );
      })}
    </ol>
  );
}
