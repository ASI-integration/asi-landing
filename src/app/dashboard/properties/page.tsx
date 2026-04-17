'use client';

import Link from 'next/link';

export default function PropertiesPage() {
  return (
    <div className="space-y-8 max-w-3xl">

      <header>
        <h1 className="text-3xl font-bold text-slate-900 tracking-tight">Объекты</h1>
        <p className="mt-2 text-lg text-slate-500 leading-relaxed">
          Все объекты вашего портфеля появятся здесь после подключения источника данных. ASI
          импортирует их автоматически и проведёт через заполнение недостающих сведений.
        </p>
      </header>

      <section className="bg-white rounded-xl border border-slate-200 p-7">
        <h2 className="text-xl font-bold text-slate-900">Как это будет работать</h2>
        <ol className="mt-5 space-y-4 text-base text-slate-600 leading-relaxed list-none">
          <li className="flex gap-4">
            <span className="shrink-0 w-7 h-7 rounded-full bg-slate-200 text-slate-600 text-sm font-bold flex items-center justify-center">1</span>
            <div>
              <p className="font-medium text-slate-900">Импорт из подключённой системы</p>
              <p className="mt-0.5 text-slate-500">ASI получает список объектов из PMS или менеджера каналов. Вам не нужно вводить данные вручную с нуля.</p>
            </div>
          </li>
          <li className="flex gap-4">
            <span className="shrink-0 w-7 h-7 rounded-full bg-slate-200 text-slate-600 text-sm font-bold flex items-center justify-center">2</span>
            <div>
              <p className="font-medium text-slate-900">Оценка полноты данных</p>
              <p className="mt-0.5 text-slate-500">Система определит, каких сведений не хватает в профиле каждого объекта — по структурированной карточке.</p>
            </div>
          </li>
          <li className="flex gap-4">
            <span className="shrink-0 w-7 h-7 rounded-full bg-slate-200 text-slate-600 text-sm font-bold flex items-center justify-center">3</span>
            <div>
              <p className="font-medium text-slate-900">Пошаговое заполнение недостающего</p>
              <p className="mt-0.5 text-slate-500">Вы заполняете только то, чего не хватает. ASI ведёт вас пошагово — без пустых форм и лишних полей.</p>
            </div>
          </li>
          <li className="flex gap-4">
            <span className="shrink-0 w-7 h-7 rounded-full bg-slate-200 text-slate-600 text-sm font-bold flex items-center justify-center">4</span>
            <div>
              <p className="font-medium text-slate-900">Шаблоны для похожих объектов</p>
              <p className="mt-0.5 text-slate-500">Если объекты похожи, система предложит заполнить их по шаблону — без повторного ввода одинаковых данных.</p>
            </div>
          </li>
        </ol>
      </section>

      <div className="rounded-xl border border-amber-200 bg-amber-50 px-6 py-5">
        <p className="text-base font-medium text-amber-800">Объекты пока не загружены</p>
        <p className="mt-1 text-sm text-amber-700">
          Чтобы начать, подключите PMS или менеджер каналов в разделе «Источник данных».
        </p>
        <Link
          href="/dashboard/data-source"
          className="mt-4 inline-flex items-center px-5 py-2.5 rounded-lg bg-amber-800 text-white text-sm font-medium hover:bg-amber-900 transition-colors"
        >
          Перейти к подключению
        </Link>
      </div>

    </div>
  );
}
