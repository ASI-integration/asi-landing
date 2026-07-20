'use client';

export default function CabinetRuntimePage() {
  return (
    <div className="space-y-8 max-w-2xl">
      <header>
        <h1 className="text-3xl font-bold text-slate-900 tracking-tight">ASI Runtime</h1>
        <p className="mt-2 text-lg text-slate-500 leading-relaxed">
          Подключение Runtime ещё не настроено
        </p>
      </header>

      <section className="bg-white rounded-xl border border-slate-200 p-7">
        <p className="text-sm text-slate-500">Статус</p>
        <p className="mt-1 text-base font-medium text-slate-900">Нет соединения</p>
      </section>
    </div>
  );
}
