export type CheckState = 'success' | 'failed' | 'pending' | 'missing' | 'skipped' | 'unknown';
export type PilotPr = {
  number: number; head: string | null; state: string; url: string;
  checks: { name: string; required: boolean; state: CheckState }[];
  review: CheckState; available: boolean;
};
export type PilotRoute = {
  source: 'main' | 'candidate'; sha: string;
  stages: { id: string; status: string }[];
};
export type PilotSnapshot = {
  checkedAt: string; available: boolean; mainSha: string | null;
  requiredKnown: boolean; prs: PilotPr[]; route: PilotRoute | null;
};
/** Display labels only; stage state is read from the SHA-bound release map. */
export const PILOT_STAGES = [
  'Безопасный ремонт EnvironmentFiles', 'Доступ оператора',
  'Сверка прежних данных', 'Полный цикл бронирования',
  'Проверка интерфейса и запрета отправок', 'Независимая приёмка',
] as const;
