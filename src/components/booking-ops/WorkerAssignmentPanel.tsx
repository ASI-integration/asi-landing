'use client';
import { useEffect, useState } from 'react';

type Task = { id: string; assigned_role: string; assigned_person_id: string | null; status: string };

export function WorkerAssignmentPanel({ bookingId, isOpsAdmin }: { bookingId: string; isOpsAdmin: boolean }) {
  const [tasks, setTasks] = useState<Task[]>([]); const [link, setLink] = useState(''); const [linkId, setLinkId] = useState(''); const [message, setMessage] = useState('');
  useEffect(() => { if (!isOpsAdmin) return; void fetch(`/api/dashboard/booking-ops/${bookingId}/worker-links`, { cache: 'no-store' }).then((r) => r.json()).then((data) => setTasks(data.tasks ?? [])); }, [bookingId, isOpsAdmin]);
  if (!isOpsAdmin) return null;
  const issue = async (task: Task) => {
    const personId = window.prompt('Имя или код исполнителя', task.assigned_person_id ?? '') ?? '';
    const expiresAt = new Date(Date.now() + 48 * 60 * 60 * 1000).toISOString();
    const response = await fetch(`/api/dashboard/booking-ops/${bookingId}/worker-links`, { method: 'POST', headers: { 'content-type': 'application/json' }, body: JSON.stringify({ taskId: task.id, role: task.assigned_role, personId, expiresAt }) });
    const data = await response.json(); if (!response.ok) { setMessage(data.message); return; }
    const absolute = `${window.location.origin}${data.link}`; setLink(absolute); setLinkId(data.linkId); await navigator.clipboard.writeText(absolute); setMessage('Ссылка создана и скопирована.');
  };
  const revoke = async () => { if (!linkId) return; const response = await fetch(`/api/dashboard/booking-ops/${bookingId}/worker-links`, { method: 'DELETE', headers: { 'content-type': 'application/json' }, body: JSON.stringify({ linkId }) }); if (response.ok) { setLink(''); setLinkId(''); setMessage('Ссылка отозвана.'); } };
  return <section className="rounded-xl border border-slate-200 bg-white p-4"><h2 className="text-lg font-semibold">Ссылки для исполнителей</h2><p className="mt-1 text-sm text-slate-600">Каждая ссылка открывает только одну назначенную задачу и действует 48 часов.</p><div className="mt-3 space-y-2">{tasks.map((task) => <div key={task.id} className="flex flex-wrap items-center justify-between gap-2 rounded-lg border p-3"><span className="text-sm">{task.assigned_role} · {task.status}</span><button className="rounded-lg border px-3 py-1.5 text-sm" onClick={() => void issue(task)}>Назначить и создать ссылку</button></div>)}{tasks.length === 0 ? <p className="text-sm text-slate-500">Задачи появятся после прохождения обязательных этапов.</p> : null}</div>{link ? <div className="mt-3 break-all rounded-lg bg-slate-50 p-3 text-sm">{link}<div className="mt-2 flex gap-2"><button className="rounded border px-2 py-1" onClick={() => void navigator.clipboard.writeText(link)}>Копировать</button><button className="rounded border border-rose-300 px-2 py-1 text-rose-700" onClick={() => void revoke()}>Отозвать</button></div></div> : null}{message ? <p className="mt-2 text-sm text-slate-700">{message}</p> : null}</section>;
}
