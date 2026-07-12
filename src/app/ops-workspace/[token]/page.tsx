'use client';
import { useEffect, useState } from 'react';

type Item = { key: string; label: string; completed: boolean };
type Task = { assigned_role: string; status: string; deadline: string | null; checklist: Item[]; notes: string | null; photo_attachments: unknown[]; issue_report: { summary?: string } | null };

export default function OpsWorkspace({ params }: { params: { token: string } }) {
  const [task, setTask] = useState<Task | null>(null); const [error, setError] = useState(''); const [busy, setBusy] = useState(false); const [issue, setIssue] = useState('');
  const load = async () => { const res = await fetch(`/api/ops-workspace/${encodeURIComponent(params.token)}`, { cache: 'no-store' }); const data = await res.json(); if (!res.ok) setError(data.error); else setTask(data.task); };
  // The token is fixed for the lifetime of this route instance.
  // eslint-disable-next-line react-hooks/exhaustive-deps
  useEffect(() => { void load(); }, [params.token]);
  const act = async (action: string, extra: Record<string, unknown> = {}) => { setBusy(true); setError(''); const res = await fetch(`/api/ops-workspace/${encodeURIComponent(params.token)}`, { method: 'PATCH', headers: { 'content-type': 'application/json' }, body: JSON.stringify({ action, checklist: task?.checklist, notes: task?.notes, ...extra }) }); const data = await res.json(); setBusy(false); if (!res.ok) setError(data.error); else setTask(data.task); };
  if (error && !task) return <main className="mx-auto max-w-xl p-6"><p className="rounded-lg bg-rose-50 p-4 text-rose-900">{error}</p></main>;
  if (!task) return <main className="p-6">Загрузка задачи…</main>;
  return <main className="mx-auto max-w-xl space-y-5 p-4 sm:p-6">
    <div><h1 className="text-2xl font-semibold">Рабочая задача</h1><p className="mt-1 text-slate-600">Роль: {task.assigned_role}. Статус: {task.status}.</p>{task.deadline ? <p className="text-sm text-slate-600">Срок: {new Date(task.deadline).toLocaleString('ru-RU')}</p> : null}</div>
    <section className="space-y-3 rounded-xl border p-4"><h2 className="font-semibold">Что нужно сделать</h2>{task.checklist.map((item, index) => <label key={item.key} className="flex gap-3"><input type="checkbox" checked={item.completed} onChange={(e) => setTask({ ...task, checklist: task.checklist.map((x, i) => i === index ? { ...x, completed: e.target.checked } : x) })}/><span>{item.label}</span></label>)}<textarea aria-label="Заметки" value={task.notes ?? ''} onChange={(e) => setTask({ ...task, notes: e.target.value })} placeholder="Заметки" className="min-h-24 w-full rounded-lg border p-3"/><p className="text-xs text-slate-500">Фото прикрепляются через существующую загрузку; здесь сохраняются данные вложений.</p></section>
    <div className="flex flex-wrap gap-2"><button disabled={busy} onClick={() => void act('start')} className="rounded-lg border px-4 py-2">Начать</button><button disabled={busy} onClick={() => void act('save')} className="rounded-lg border px-4 py-2">Сохранить</button><button disabled={busy || !task.checklist.every((x) => x.completed)} onClick={() => void act('complete')} className="rounded-lg bg-emerald-700 px-4 py-2 text-white disabled:opacity-50">Завершить</button></div>
    <section className="space-y-2 rounded-xl border border-amber-200 bg-amber-50 p-4"><h2 className="font-semibold">Сообщить о проблеме</h2><textarea value={issue} onChange={(e) => setIssue(e.target.value)} className="min-h-20 w-full rounded-lg border p-3" placeholder="Кратко опишите проблему"/><button disabled={busy || !issue.trim()} onClick={() => void act('report_issue', { summary: issue, blocking: true })} className="rounded-lg bg-amber-700 px-4 py-2 text-white">Отправить</button>{task.issue_report?.summary ? <p className="text-sm">Проблема записана: {task.issue_report.summary}</p> : null}</section>
    {error ? <p className="text-rose-700">{error}</p> : null}
  </main>;
}
