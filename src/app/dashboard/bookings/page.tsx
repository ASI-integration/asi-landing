'use client';

export default function BookingsPage() {
  return (
    <div className="space-y-8 max-w-3xl">

      <header>
        <h1 className="text-3xl font-bold text-slate-900 tracking-tight">Бронирования</h1>
        <p className="mt-2 text-lg text-slate-500 leading-relaxed">
          Третий основополагающий контур системы — операционный слой бронирований и размещения.
          Станет доступен после подключения источника данных и объектов.
        </p>
      </header>

      <section className="bg-white rounded-xl border border-slate-200 p-7">
        <h2 className="text-xl font-bold text-slate-900">Назначение этого контура</h2>
        <div className="mt-4 space-y-3 text-base text-slate-600 leading-relaxed">
          <p>
            Контур бронирований обеспечивает приём, распределение и операционное сопровождение
            размещений. Это не просто список бронирований — это рабочая среда для управления
            потоком гостей и операционными данными.
          </p>
          <p>
            Данные поступают из подключённого PMS или менеджера каналов. ASI обогащает их и
            помогает операторам действовать быстрее и точнее.
          </p>
        </div>
      </section>

      <section className="bg-slate-50 rounded-xl border border-slate-200 p-7">
        <h2 className="text-lg font-bold text-slate-900">Что будет доступно</h2>
        <ul className="mt-4 space-y-3 text-base text-slate-600 leading-relaxed">
          <li className="flex gap-3">
            <span className="shrink-0 mt-1 w-1.5 h-1.5 rounded-full bg-slate-400 inline-block" />
            <span>Актуальный список бронирований из подключённого источника</span>
          </li>
          <li className="flex gap-3">
            <span className="shrink-0 mt-1 w-1.5 h-1.5 rounded-full bg-slate-400 inline-block" />
            <span>Операционный статус каждого размещения</span>
          </li>
          <li className="flex gap-3">
            <span className="shrink-0 mt-1 w-1.5 h-1.5 rounded-full bg-slate-400 inline-block" />
            <span>Связь с коммуникационным контуром и объектами</span>
          </li>
          <li className="flex gap-3">
            <span className="shrink-0 mt-1 w-1.5 h-1.5 rounded-full bg-slate-400 inline-block" />
            <span>Поддержка операционных процессов: заезд, выезд, передача данных</span>
          </li>
        </ul>
      </section>

      <div className="rounded-xl border border-amber-200 bg-amber-50 px-6 py-5">
        <p className="text-base font-medium text-amber-800">Требует подключения источника данных</p>
        <p className="mt-1 text-sm text-amber-700">
          Данные о бронированиях появятся здесь после того, как будет подключён PMS или менеджер
          каналов и импортированы объекты.
        </p>
      </div>

    </div>
  );
}
