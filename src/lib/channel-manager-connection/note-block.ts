import type {
  ChannelManagerAccessSituation,
  ChannelManagerConnectionMethod,
  ChannelManagerConnectionState,
  ChannelManagerConnectionStatus,
  ChannelManagerObjectInManager,
  ChannelManagerRoute,
  MkAutomationConnectionStatus,
} from './types';

export const CHANNEL_MANAGER_CONNECTION_HEADER = 'Подключение МК ASI';

const METHOD_BY_LABEL: Record<string, ChannelManagerConnectionMethod> = {
  realtycalendar: 'realtycalendar',
  bnovo: 'bnovo',
  manual_import: 'manual_import',
  other: 'other',
  none_yet: 'none_yet',
};

const ACCESS_BY_LABEL: Record<string, ChannelManagerAccessSituation> = {
  has_access: 'has_access',
  from_scratch: 'from_scratch',
  needs_help: 'needs_help',
};

const STATUS_BY_LABEL: Record<string, ChannelManagerConnectionStatus> = {
  ready_to_connect: 'ready_to_connect',
  waiting_access: 'waiting_access',
  verifying_data: 'verifying_data',
  prepared: 'prepared',
  needs_operator: 'needs_operator',
  connected: 'connected',
  primary_setup_needed: 'primary_setup_needed',
};

const ROUTE_BY_LABEL: Record<string, ChannelManagerRoute> = {
  has_manager: 'has_manager',
  no_manager: 'no_manager',
  unknown: 'unknown',
};

const OBJECT_IN_MANAGER_BY_LABEL: Record<string, ChannelManagerObjectInManager> = {
  yes: 'yes',
  no: 'no',
  unknown: 'unknown',
};

const CONNECTION_STATUS_BY_LABEL: Record<string, MkAutomationConnectionStatus> = {
  needs_manager_check: 'needs_manager_check',
  needs_manager_selection: 'needs_manager_selection',
  needs_object_preparation: 'needs_object_preparation',
  needs_access_confirmation: 'needs_access_confirmation',
  ready_for_operator_review: 'ready_for_operator_review',
  waiting_for_owner: 'waiting_for_owner',
  done: 'done',
};

function getLineValue(lines: string[], prefix: string): string {
  const line = lines.find((item) => item.startsWith(prefix));
  return line ? line.slice(prefix.length).trim() : '';
}

function parseCsv(raw: string): string[] {
  return raw.split(',').map((item) => item.trim()).filter(Boolean);
}

export function parseChannelManagerConnectionBlock(note: string | null | undefined): ChannelManagerConnectionState | null {
  const lines = String(note ?? '')
    .split('\n')
    .map((line) => line.trim());
  const start = lines.findIndex((line) => line === CHANNEL_MANAGER_CONNECTION_HEADER);
  if (start === -1) return null;

  const blockLines = lines.slice(start + 1);
  const methodRaw = getLineValue(blockLines, 'Способ:');
  const accessRaw = getLineValue(blockLines, 'Доступ:');
  const statusRaw = getLineValue(blockLines, 'Статус:');

  const method = METHOD_BY_LABEL[methodRaw] ?? null;
  const accessSituation = ACCESS_BY_LABEL[accessRaw] ?? null;
  const status = STATUS_BY_LABEL[statusRaw] ?? 'ready_to_connect';
  const nextStepRu = getLineValue(blockLines, 'Следующий шаг:') || 'Выберите способ подключения каналов.';
  const customManagerName = getLineValue(blockLines, 'Другой МК:') || null;
  const objectId = getLineValue(blockLines, 'object_id=') || null;
  const contactId = getLineValue(blockLines, 'contact_id=') || null;
  const selectedChannelManager = getLineValue(blockLines, 'Выбранный МК:') || null;
  const routeRaw = getLineValue(blockLines, 'Ветка МК:');
  const objectInManagerRaw = getLineValue(blockLines, 'Объект в МК v1:');
  const targetPlacementRaw = getLineValue(blockLines, 'Площадки через МК:');
  const connectionStatusRaw = getLineValue(blockLines, 'Статус подключения:');
  const updatedAt = getLineValue(blockLines, 'Обновлено:') || null;

  return {
    objectId,
    contactId,
    method,
    customManagerName,
    accessSituation,
    status,
    nextStepRu,
    selectedChannelManager,
    channelManagerRoute: ROUTE_BY_LABEL[routeRaw] ?? null,
    objectInChannelManager: OBJECT_IN_MANAGER_BY_LABEL[objectInManagerRaw] ?? null,
    targetPlacementChannels: targetPlacementRaw ? parseCsv(targetPlacementRaw) : [],
    connectionStatus: CONNECTION_STATUS_BY_LABEL[connectionStatusRaw] ?? null,
    nextOperatorAction: getLineValue(blockLines, 'Следующее действие оператора:') || null,
    nextOwnerMessage: getLineValue(blockLines, 'Сообщение владельцу:') || null,
    updatedAt,
  };
}

export function buildChannelManagerConnectionBlock(state: ChannelManagerConnectionState): string {
  return [
    CHANNEL_MANAGER_CONNECTION_HEADER,
    state.objectId ? `object_id=${state.objectId}` : null,
    state.contactId ? `contact_id=${state.contactId}` : null,
    state.method ? `Способ: ${state.method}` : 'Способ:',
    state.customManagerName ? `Другой МК: ${state.customManagerName}` : null,
    state.accessSituation ? `Доступ: ${state.accessSituation}` : null,
    `Статус: ${state.status}`,
    `Следующий шаг: ${state.nextStepRu}`,
    state.selectedChannelManager ? `Выбранный МК: ${state.selectedChannelManager}` : null,
    state.channelManagerRoute ? `Ветка МК: ${state.channelManagerRoute}` : null,
    state.objectInChannelManager ? `Объект в МК v1: ${state.objectInChannelManager}` : null,
    state.targetPlacementChannels?.length ? `Площадки через МК: ${state.targetPlacementChannels.join(', ')}` : null,
    state.connectionStatus ? `Статус подключения: ${state.connectionStatus}` : null,
    state.nextOperatorAction ? `Следующее действие оператора: ${state.nextOperatorAction}` : null,
    state.nextOwnerMessage ? `Сообщение владельцу: ${state.nextOwnerMessage}` : null,
    state.updatedAt ? `Обновлено: ${state.updatedAt}` : null,
  ]
    .filter(Boolean)
    .join('\n');
}

export function noteWithoutChannelManagerBlock(note: string): string {
  const lines = note.split('\n');
  const kept: string[] = [];
  let index = 0;
  while (index < lines.length) {
    const trimmed = lines[index].trim();
    if (trimmed === CHANNEL_MANAGER_CONNECTION_HEADER) {
      index += 1;
      while (index < lines.length && lines[index].trim() !== '') index += 1;
      if (lines[index]?.trim() === '') index += 1;
      continue;
    }
    kept.push(lines[index]);
    index += 1;
  }
  return kept.join('\n').trim();
}

export function mergeChannelManagerConnectionIntoNote(
  note: string,
  state: ChannelManagerConnectionState,
): string {
  const base = noteWithoutChannelManagerBlock(note);
  const block = buildChannelManagerConnectionBlock(state);
  return [base, block].filter(Boolean).join('\n\n').slice(0, 4000);
}
