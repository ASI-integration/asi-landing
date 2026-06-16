import Link from 'next/link';
import { PilotApplicationForm } from './PilotApplicationForm';

export const metadata = {
  title: 'Заявка в пилот ASI',
  description: 'Закрытый пилот ASI для владельцев и управляющих объектами посуточной аренды.',
};

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

          <div className="grid gap-3 text-sm text-slate-700">
            <div className="rounded-lg border border-slate-200 bg-white p-4">
              🎁 Участие в пилоте бесплатное. Мы берем всего 2–3 реальных объекта,
              чтобы отточить алгоритмы на живом контуре.
            </div>
            <div className="rounded-lg border border-slate-200 bg-white p-4">
              ✨ Кому подойдет: владельцам и управляющим, у которых есть готовые
              объекты и реальные бронирования.
            </div>
            <div className="rounded-lg border border-slate-200 bg-white p-4">
              ⚙️ Как действуем: сначала фиксируем текущую схему вашего объекта и
              сценарии тестов. Подключение каналов и OTA-площадок запустим следующим
              этапом, плавно и безопасно.
            </div>
          </div>
        </section>

        <section>
          <PilotApplicationForm />
        </section>
      </div>
    </main>
  );
}
