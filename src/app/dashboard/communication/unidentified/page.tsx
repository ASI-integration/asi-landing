'use client';
import { useEffect, useState } from 'react';
type Item = { reviewId: string; channel: string; status: string; updatedAt: string };
export default function UnidentifiedConversations() {
  const [items, setItems] = useState<Item[]>([]);
  const [error, setError] = useState('');
  const [busy, setBusy] = useState(false);
  async function load() {
    const response = await fetch('/api/operator/unidentified-reviews', { cache: 'no-store' });
    if (!response.ok) throw new Error(response.status === 403
      ? 'Эта очередь доступна только назначенным операторам ASI.' : 'Не удалось загрузить очередь. Попробуйте ещё раз.');
    setItems((await response.json()).items);
  }
  useEffect(() => { void load().catch((error: Error) => setError(error.message)); }, []);
  async function act(reviewId: string, action: string) {
    setBusy(true); setError('');
    try {
      const response = await fetch('/api/operator/unidentified-reviews', { method: 'POST',
        headers: { 'Content-Type': 'application/json' }, body: JSON.stringify({ reviewId, action }) });
      if (!response.ok) throw new Error('Действие не подтверждено. Диалог остаётся у оператора.');
      await load();
    } catch (error) { setError(error instanceof Error ? error.message : 'Не удалось выполнить действие.'); }
    finally { setBusy(false); }
  }
  return <main className="mx-auto max-w-3xl space-y-6 p-6">
    <a href="/dashboard/communication">← Коммуникация с гостями</a>
    <h1 className="text-3xl font-semibold">Диалоги без подтверждённого объекта</h1>
    <p>Объект и владелец ещё не установлены. Уточните номер бронирования и название объекта.
      До проверки ASI не сообщает сведения об объекте и не возвращает диалог автоматике.</p>
    <p className="text-sm">Кнопка запроса отправляет только просьбу уточнить бронирование.
      Она не привязывает гостя к владельцу и не открывает доступ к данным объекта.</p>
    {error && <p role="alert">{error}</p>}
    {!error && !items.length && <p>Диалогов в очереди нет.</p>}
    {items.map((item) => <section key={item.reviewId} className="space-y-3 rounded border p-4">
      <p>{item.channel} · {item.status} · {item.updatedAt}</p>
      <div className="flex flex-wrap gap-3">
        <button disabled={busy} onClick={() => void act(item.reviewId, 'acknowledge')}>Взять в работу</button>
        <button disabled={busy} onClick={() => void act(item.reviewId, 'request_identity')}>Запросить номер бронирования</button>
      </div>
    </section>)}
  </main>;
}
