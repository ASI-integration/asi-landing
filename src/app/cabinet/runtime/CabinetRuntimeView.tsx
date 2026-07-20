import type { PublicAsiRuntimeSnapshot } from '@/lib/asi-runtime/types';

type CabinetRuntimeViewProps = {
  loading: boolean;
  error: string | null;
  snapshot: PublicAsiRuntimeSnapshot | null;
};

function formatTimestamp(value: string): string {
  const parsed = Date.parse(value);
  if (!Number.isFinite(parsed)) return value;
  return new Date(parsed).toLocaleString('ru-RU');
}

export function CabinetRuntimeView({ loading, error, snapshot }: CabinetRuntimeViewProps) {
  const connected = Boolean(snapshot);

  return (
    <div className="space-y-8 max-w-2xl">
      <header>
        <h1 className="text-3xl font-bold text-slate-900 tracking-tight">ASI Runtime</h1>
        <p className="mt-2 text-lg text-slate-500 leading-relaxed">
          {connected ? 'Последнее сохранённое состояние Runtime' : 'Данные Runtime ещё не поступали'}
        </p>
      </header>

      <section className="bg-white rounded-xl border border-slate-200 p-7 space-y-4">
        <div>
          <p className="text-sm text-slate-500">Статус</p>
          <p className="mt-1 text-base font-medium text-slate-900">
            {loading ? 'Загрузка…' : connected ? snapshot?.status ?? '—' : 'Нет соединения'}
          </p>
        </div>

        {error ? (
          <p className="text-sm text-red-600">{error}</p>
        ) : null}

        {!loading && !error && snapshot ? (
          <dl className="grid gap-3 text-sm">
            <div>
              <dt className="text-slate-500">Название задачи</dt>
              <dd className="font-medium text-slate-900">{snapshot.taskTitle}</dd>
            </div>
            <div>
              <dt className="text-slate-500">Текущий этап</dt>
              <dd className="font-medium text-slate-900">{snapshot.currentStage || '—'}</dd>
            </div>
            <div>
              <dt className="text-slate-500">Выполнено шагов</dt>
              <dd className="font-medium text-slate-900">{snapshot.completedSteps}</dd>
            </div>
            <div>
              <dt className="text-slate-500">Всего шагов</dt>
              <dd className="font-medium text-slate-900">{snapshot.totalSteps}</dd>
            </div>
            <div>
              <dt className="text-slate-500">Процент</dt>
              <dd className="font-medium text-slate-900">{snapshot.progressPercent}%</dd>
            </div>
            <div>
              <dt className="text-slate-500">Provider</dt>
              <dd className="font-medium text-slate-900">{snapshot.provider || '—'}</dd>
            </div>
            <div>
              <dt className="text-slate-500">Attempt</dt>
              <dd className="font-medium text-slate-900">{snapshot.attemptNumber}</dd>
            </div>
            <div>
              <dt className="text-slate-500">Commit</dt>
              <dd className="font-medium text-slate-900">{snapshot.commitSha || '—'}</dd>
            </div>
            <div>
              <dt className="text-slate-500">PR</dt>
              <dd className="font-medium text-slate-900">
                {snapshot.pullRequestUrl ? (
                  <a href={snapshot.pullRequestUrl} className="text-slate-900 underline" target="_blank" rel="noreferrer">
                    {snapshot.pullRequestUrl}
                  </a>
                ) : (
                  '—'
                )}
              </dd>
            </div>
            <div>
              <dt className="text-slate-500">Verification status</dt>
              <dd className="font-medium text-slate-900">{snapshot.verificationStatus || '—'}</dd>
            </div>
            <div>
              <dt className="text-slate-500">Последнее событие</dt>
              <dd className="font-medium text-slate-900">{snapshot.lastEvent || '—'}</dd>
            </div>
            <div>
              <dt className="text-slate-500">Время обновления</dt>
              <dd className="font-medium text-slate-900">{formatTimestamp(snapshot.updatedAt)}</dd>
            </div>
          </dl>
        ) : null}
      </section>
    </div>
  );
}
