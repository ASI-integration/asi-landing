'use client';
import Link from 'next/link';
import { useEffect, useState } from 'react';

type Summary = { status: string; blockingItems: string[]; warnings: string[] };
export function ExceptionOnlySummary({ enabled }: { enabled: boolean }) {
  const [summary, setSummary] = useState<Summary | null>(null);
  useEffect(() => { if (!enabled) return; void fetch('/api/dashboard/ops-v17', { cache: 'no-store' }).then((r) => r.json()).then((body) => setSummary(body.workspace?.readiness ?? null)).catch(() => undefined); }, [enabled]);
  if (!enabled || !summary) return null;
  const exceptions = [...summary.blockingItems, ...summary.warnings];
  return <section className="rounded-xl border border-amber-200 bg-amber-50 p-5"><div className="flex flex-wrap items-center justify-between gap-3"><div><h2 className="text-lg font-semibold text-slate-900">Требует внимания</h2><p className="text-sm text-slate-600">Блокеры, сбои, просроченные задачи, нерешённые вопросы и согласования.</p></div><Link href="/dashboard/onboarding" className="rounded-lg border border-slate-300 bg-white px-3 py-2 text-sm">Открыть запуск</Link></div>{exceptions.length ? <ul className="mt-3 grid gap-2 sm:grid-cols-2">{exceptions.map((item) => <li key={item} className="rounded-lg bg-white p-3 text-sm">{item}</li>)}</ul> : <p className="mt-3 text-sm text-emerald-800">Новых исключений нет. Система работает штатно.</p>}<Link href="/dashboard/booking-ops" className="mt-4 inline-block text-sm underline">Расширенный рабочий кабинет</Link></section>;
}
