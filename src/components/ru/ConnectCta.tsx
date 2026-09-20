import Link from 'next/link';

export const RU_CONNECT_HREF = '/ru/connect';
export const RU_SPECIAL_OFFER_HREF = '#special-offer';

export function ConnectCta({
  id,
  href = RU_CONNECT_HREF,
  title = 'НАЧАТЬ ПОДКЛЮЧЕНИЕ',
  description = 'Сначала вход или регистрация. Затем — настройка объекта.',
  testId = 'start-connection',
}: {
  id?: string;
  /** Defaults to /ru/connect. Homepage wide CTAs may pass #special-offer. */
  href?: string;
  title?: string;
  description?: string;
  testId?: string;
}) {
  return (
    <Link
      id={id}
      href={href}
      data-testid={testId}
      className="group flex w-full items-center justify-between gap-4 bg-asi-navy px-5 py-5 text-asi-ivory sm:px-8 sm:py-7 hover:bg-asi-navy-2 transition-colors focus-visible:outline focus-visible:outline-4 focus-visible:outline-offset-4 focus-visible:outline-asi-gold"
    >
      <span>
        <span className="block text-lg sm:text-2xl font-semibold">{title}</span>
        <span className="mt-2 block text-sm sm:text-base text-asi-ivory/80">{description}</span>
      </span>
      <span aria-hidden="true" className="shrink-0 text-3xl sm:text-4xl">
        →
      </span>
    </Link>
  );
}
