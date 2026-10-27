/** Observation DTO only: no task, queue, command or execution authority. */
export const OPERATIONS_SCHEMA = 'asi.operations.v1';
export const OPERATIONS_STALE_MS = 120_000;
export const OPERATION_IDS = ['backup-gh', 'server-backups', 'runtime-worker'] as const;
export type OperationId = typeof OPERATION_IDS[number];
export type OperationStatus = 'RUNNING' | 'HOLD' | 'DONE' | 'ERROR' | 'BLOCKED' | 'UNKNOWN' | 'STALE';
export type OperationRecord = {
  id: OperationId;
  status: Exclude<OperationStatus, 'STALE' | 'HOLD'>;
  sourceUpdatedAt: string | null;
  process: 'PRESENT' | 'ABSENT' | 'UNKNOWN';
  task: 'ACTIVE' | 'IDLE' | 'UNKNOWN';
  completed: number | null;
  total: number | null;
  bytes: number | null;
  totalBytes: number | null;
  errors: number | null;
  archives: Array<{ batch: 'core' | 'video' | 'releases' | 'supplemental'; sha256: string; bytes: number }>;
};
export type OperationsPayload = {schemaVersion: typeof OPERATIONS_SCHEMA; observedAt: string; records: OperationRecord[]};
export type OperationsStored = OperationsPayload & {receivedAt: string};
export type OperationCard = {
  id: string; title: string; product: string; status: OperationStatus;
  sourceUpdatedAt: string | null; observedAt: string | null;
  process: OperationRecord['process']; task: OperationRecord['task'];
  completed: number | null; total: number | null; bytes: number | null; totalBytes: number | null;
  errors: number | null; archives: OperationRecord['archives'];
  detail: string; nextStep: string; criteria?: string[];
};
export type OperationsSnapshot = {schemaVersion: typeof OPERATIONS_SCHEMA; fetchedAt: string; cards: OperationCard[]};
const keys = ['id','status','sourceUpdatedAt','process','task','completed','total','bytes','totalBytes','errors','archives'];
const obj = (v: unknown): v is Record<string, unknown> => !!v && typeof v === 'object' && !Array.isArray(v);
const exact = (v: Record<string, unknown>, allowed: string[]) => Object.keys(v).length === allowed.length && Object.keys(v).every(k => allowed.includes(k));
const date = (v: unknown): v is string => typeof v === 'string' && /^\d{4}-\d{2}-\d{2}T\d{2}:\d{2}:\d{2}(?:\.\d{1,3})?(?:Z|\+00:00)$/.test(v) && Number.isFinite(Date.parse(v));
const count = (v: unknown) => v === null || (typeof v === 'number' && Number.isSafeInteger(v) && v >= 0);
/** Reject arbitrary text/extra fields rather than attempting to redact secrets. */
export function parseOperationsPayload(value: unknown): OperationsPayload | null {
  if (!obj(value) || !exact(value, ['schemaVersion','observedAt','records']) || value.schemaVersion !== OPERATIONS_SCHEMA || !date(value.observedAt) || !Array.isArray(value.records) || value.records.length !== 3) return null;
  const seen = new Set<string>();
  for (const r of value.records) {
    if (!obj(r) || !exact(r, keys) || !OPERATION_IDS.includes(r.id as OperationId) || seen.has(String(r.id)) || (typeof r.status !== 'string' || !['RUNNING','DONE','ERROR','BLOCKED','UNKNOWN'].includes(r.status)) || (typeof r.process !== 'string' || !['PRESENT','ABSENT','UNKNOWN'].includes(r.process)) || (typeof r.task !== 'string' || !['ACTIVE','IDLE','UNKNOWN'].includes(r.task))) return null;
    if (r.sourceUpdatedAt !== null && (!date(r.sourceUpdatedAt) || Date.parse(r.sourceUpdatedAt) > Date.parse(value.observedAt) + 30_000)) return null;
    if (!['completed','total','bytes','totalBytes','errors'].every(k => count(r[k]))) return null;
    if ((r.total !== null && r.completed !== null && Number(r.completed) > Number(r.total)) || (r.totalBytes !== null && r.bytes !== null && Number(r.bytes) > Number(r.totalBytes))) return null;
    if (!Array.isArray(r.archives) || r.archives.length > 4) return null;
    const batches = new Set<string>();
    for (const a of r.archives) {
      if (!obj(a) || !exact(a, ['batch','sha256','bytes']) || (typeof a.batch !== 'string' || !['core','video','releases','supplemental'].includes(a.batch)) || batches.has(String(a.batch)) || typeof a.sha256 !== 'string' || !/^[a-f0-9]{64}$/.test(a.sha256) || a.bytes === null || !count(a.bytes)) return null;
      batches.add(String(a.batch));
    }
    if (r.id !== 'server-backups' && r.archives.length) return null;
    if (r.id === 'runtime-worker' && (r.task !== 'UNKNOWN' || r.status === 'DONE' || r.completed !== null || r.total !== null || r.bytes !== null || r.totalBytes !== null)) return null;
    if (r.status !== 'UNKNOWN' && r.sourceUpdatedAt === null) return null;
    if (r.status === 'DONE' && (r.errors !== 0 || !r.total || r.completed !== r.total)) return null;
    if (r.id === 'server-backups' && r.status === 'DONE' && (r.archives.length !== 4 || r.total !== 4)) return null;
    seen.add(String(r.id));
  }
  // Rebuild after strict validation; never return unvalidated stored properties.
  return JSON.parse(JSON.stringify(value)) as OperationsPayload;
}
const labels: Record<OperationId, [string,string]> = {
  'backup-gh': ['Backup G → H', 'Резервирование'],
  'server-backups': ['Серверные резервные копии', 'ASI'],
  'runtime-worker': ['ASI Runtime Worker', 'ASI'],
};
export function operationCard(id: OperationId, stored: OperationsStored | null, now: number): OperationCard {
  const r = stored?.records.find(x => x.id === id);
  const invalidTime = !stored || !date(stored.receivedAt) || Date.parse(stored.observedAt) > now + 30_000 || Date.parse(stored.receivedAt) > now + 30_000;
  const stale = !invalidTime && (now - Date.parse(stored!.observedAt) > OPERATIONS_STALE_MS || now - Date.parse(stored!.receivedAt) > OPERATIONS_STALE_MS || (id === 'backup-gh' && r?.status === 'RUNNING' && (!r.sourceUpdatedAt || now - Date.parse(r.sourceUpdatedAt) > OPERATIONS_STALE_MS)));
  const status: OperationStatus = !r || invalidTime ? 'UNKNOWN' : stale ? 'STALE' : r.status;
  const detail = id === 'backup-gh' ? 'Проверенные файлы и объём из отчёта копирования. Объём округлён источником.' : id === 'server-backups' ? 'SHA-256 сохранённых архивов. Это отдельные копии, не единый снимок; внешняя база и лаборатория не покрыты. Проверка восстановления не подтверждена.' : 'Проверено только наличие локального процесса. Выполнение и завершение задания не подтверждены.';
  return {id,title:labels[id][0],product:labels[id][1],status,
    sourceUpdatedAt:r?.sourceUpdatedAt ?? null,observedAt:stored?.observedAt ?? null,
    process:r?.process ?? 'UNKNOWN',task:r?.task ?? 'UNKNOWN',completed:r?.completed ?? null,total:r?.total ?? null,
    bytes:r?.bytes ?? null,totalBytes:r?.totalBytes ?? null,errors:r?.errors ?? null,archives:r?.archives ?? [],detail:status === 'BLOCKED' && r?.process === 'ABSENT' ? detail + ' Указанный процесс не обнаружен.' : detail,
    nextStep:status === 'STALE' ? 'Дождаться свежего подтверждённого отчёта. Последние значения сохранены.' : status === 'UNKNOWN' ? 'Подключить или проверить источник статуса.' : status === 'ERROR' || status === 'BLOCKED' ? 'Проверить локальный отчёт; панель не повторяет и не останавливает работу.' : id === 'runtime-worker' ? 'Дождаться отдельного подтверждения выполняемого задания.' : 'Продолжать наблюдение; панель не управляет процессом.'};
}
