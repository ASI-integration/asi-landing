'use client';

import { useMemo } from 'react';
import Link from 'next/link';
import { LOCATION_REPORT_PRODUCT_PATH, LOCATION_REPORT_SAMPLE_PATH } from '@/lib/location/report-state';

export default function RuLocationFullReportPage() {
  const emptyState = useMemo(() => {
    return (
      <div className="min-h-screen bg-slate-950 text-white">
        <div className="max-w-3xl mx-auto px-4 sm:px-6 py-16 sm:py-24">
          <div className="rounded-3xl border border-slate-800/70 bg-slate-900/20 p-8 sm:p-10">
            <p className="text-[11px] uppercase tracking-[0.22em] text-slate-500">Полный отчёт</p>
            <h1 className="mt-3 text-3xl sm:text-4xl font-bold tracking-tight">Отчёт открывается по личной ссылке</h1>
            <p className="mt-3 text-slate-300 leading-relaxed">
              Сначала введите адрес и получите бесплатный предпросмотр. После заказа и подтверждения оплаты мы
              сформируем полный отчёт по посуточной аренде и отправим отдельную ссылку.
            </p>
            <div className="mt-7 flex flex-col sm:flex-row gap-3">
              <Link
                href={LOCATION_REPORT_PRODUCT_PATH}
                className="inline-flex items-center justify-center px-6 py-3 rounded-xl bg-white text-slate-900 font-bold hover:bg-slate-100 transition-colors"
              >
                Получить отчёт по посуточной аренде
              </Link>
              <Link
                href={LOCATION_REPORT_SAMPLE_PATH}
                className="inline-flex items-center justify-center px-6 py-3 rounded-xl border border-slate-800/70 text-slate-200 hover:text-white hover:border-slate-700 transition-colors"
              >
                Открыть пример отчёта
              </Link>
            </div>
            <p className="mt-4 text-xs text-slate-600">
              Для ознакомления можно открыть демонстрационный пример — он показывает структуру платного отчёта.
            </p>
          </div>
        </div>
      </div>
    );
  }, []);

  return emptyState;
}

