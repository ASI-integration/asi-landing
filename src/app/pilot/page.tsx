import Link from 'next/link';
import { PilotApplicationForm } from './PilotApplicationForm';

export const metadata = {
  title: 'Заявка в пилот ASI',
  description: 'Закрытый пилот ASI для владельцев и управляющих объектами посуточной аренды.',
};

const pilotInfoBlocks = [
  {
    icon: '🎁',
    title: 'Участие в пилоте бесплатное',
    body: 'Мы берем всего 2–3 реальных объекта, чтобы отточить алгоритмы на живом контуре.',
  },
  {
    icon: '✨',
    title: 'Кому подойдёт',
    body: 'Владельцам и управляющим, у которых есть готовые объекты и реальные бронирования.',
  },
  {
    icon: '⚙️',
    title: 'Как действуем',
    body: 'Сначала фиксируем текущую схему вашего объекта и сценарии тестов. Подключение каналов и OTA-площадок запустим следующим этапом, плавно и безопасно.',
  },
];

export default function PilotPage() {
  return (
    <main className="min-h-screen bg-slate-50 px-4 py-8 text-slate-900 sm:px-6 lg:px-8">
      <div className="mx-auto grid max-w-6xl gap-8 lg:grid-cols-[0.9fr_1.1fr] lg:items-start">
        <section className="space-y-6">
          <Link href="/" className="text-sm font-medium text-slate-600 hover:text-slate-900">
            ASI
          </Link>
          <div className="space-y-4">
            <p className="text-sm font-semibold uppercase tracking-normal text-emerald-700">
              Закрытый пилот
            </p>
            <h1 className="text-4xl font-bold tracking-normal text-slate-950 sm:text-5xl">
              Заявка на участие в пилоте ASI
            </h1>
            <p className="max-w-xl text-lg leading-8 text-slate-600">
              ASI — это полноценный автопилот для посуточной аренды. Система забирает
              на себя рутину: от умного ведения объекта по этапам до автоматической
              коммуникации с гостями.
            </p>
          </div>

          <div className="grid gap-3">
            {pilotInfoBlocks.map((item) => (
              <article key={item.title} className="rounded-lg border border-slate-200 bg-white p-4 shadow-sm">
                <div className="flex items-start gap-3">
                  <span aria-hidden="true" className="mt-0.5 text-xl leading-none">
                    {item.icon}
                  </span>
                  <div className="space-y-1">
                    <h2 className="text-lg font-bold leading-6 text-slate-950">{item.title}</h2>
                    <p className="text-sm leading-6 text-slate-700">{item.body}</p>
                  </div>
                </div>
              </article>
            ))}
          </div>
        </section>

        <section>
          <PilotApplicationForm />
        </section>
      </div>
    </main>
  );
}
