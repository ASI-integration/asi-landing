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
              ASI автоматизирует процессы в посуточной аренде: коммуникации, данные объекта,
              подготовку к подключению каналов и следующие шаги для владельца или управляющего.
            </p>
          </div>

          <div className="grid gap-3 text-sm text-slate-700">
            <div className="rounded-lg border border-slate-200 bg-white p-4">
              Пилот бесплатный. Сейчас берём 2-3 реальных объекта, чтобы проверить работу на живом контуре.
            </div>
            <div className="rounded-lg border border-slate-200 bg-white p-4">
              Лучше всего подходит владелец или управляющий, у которого уже есть объект и реальные брони.
            </div>
            <div className="rounded-lg border border-slate-200 bg-white p-4">
              Подключение каналов и площадок будет следующим этапом. Сначала фиксируем текущую схему,
              объект и сценарий теста.
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
