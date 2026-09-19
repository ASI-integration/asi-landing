import Link from 'next/link';

export const RU_CONNECT_HREF = '/ru/connect';

export function ConnectCta({ id }: { id?: string }) {
  return (
    <Link
      id={id}
      href={RU_CONNECT_HREF}
      data-testid="start-connection"
      className="group flex w-full items-center justify-between gap-4 bg-asi-navy px-5 py-5 text-asi-ivory sm:px-8 sm:py-7 hover:bg-asi-navy-2 transition-colors focus-visible:outline focus-visible:outline-4 focus-visible:outline-offset-4 focus-visible:outline-asi-gold"
    >
      <span>
        <span className="block text-lg sm:text-2xl font-semibold">НАЧАТЬ ПОДКЛЮЧЕНИЕ</span>
        <span className="mt-2 block text-sm sm:text-base text-asi-ivory/80">
          Сначала вход или регистрация. Затем — настройка объекта.
        </span>
      </span>
      <span aria-hidden="true" className="shrink-0 text-3xl sm:text-4xl">→</span>
    </Link>
  );
}
