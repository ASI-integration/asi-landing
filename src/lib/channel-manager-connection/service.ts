import type { CrmContact, CrmOnboardingStatus } from '@/lib/crm/types';
import { getCrmContactById, updateCrmContact } from '@/lib/crm/repository';
import {
  applyCustomManagerName,
  applyOpenFlow,
  applySelectAccess,
  applySelectMethod,
  buildChannelManagerConnectionHref,
  initialConnectionState,
  isReadyForChannelManagerFlow,
  onboardingStatusAfterConnection,
} from './flow';
import {
  mergeChannelManagerConnectionIntoNote,
  parseChannelManagerConnectionBlock,
} from './note-block';
import {
  emitChannelManagerAccessRequested,
  emitChannelManagerConnectionPrepared,
  emitChannelManagerFlowPrepared,
  emitChannelManagerMethodSelected,
  emitChannelManagerNeedsOperator,
} from './crm-events';
import { createOpsTaskFromChannelManager } from '@/lib/ops-board/integrations';
import type {
  ChannelManagerAccessSituation,
  ChannelManagerConnectionAction,
  ChannelManagerConnectionMethod,
  ChannelManagerConnectionState,
} from './types';

const ONBOARDING_HEADER = 'Онбординг ASI';

function extractObjectIdFromOnboardingNote(note: string): string | null {
  const match = note.match(/object_id=([a-zA-Z0-9_-]+)/);
  return match?.[1] ?? null;
}

function extractOnboardingStatus(note: string): CrmOnboardingStatus | null {
  const lines = note.split('\n').map((line) => line.trim());
  const start = lines.findIndex((line) => line === ONBOARDING_HEADER);
  if (start === -1) return null;
  const statusLine = lines.slice(start + 1).find((line) => line.startsWith('Статус:'));
  if (!statusLine) return null;
  const raw = statusLine.slice('Статус:'.length).trim();
  const allowed: CrmOnboardingStatus[] = [
    'onboarding_started',
    'missing_required_data',
    'ready_for_channel_manager',
    'channel_manager_started',
    'needs_operator',
  ];
  return allowed.includes(raw as CrmOnboardingStatus) ? (raw as CrmOnboardingStatus) : null;
}

function extractReadinessPercent(note: string): number | null {
  const lines = note.split('\n').map((line) => line.trim());
  const start = lines.findIndex((line) => line === ONBOARDING_HEADER);
  if (start === -1) return null;
  const line = lines.slice(start + 1).find((item) => item.startsWith('Готовность:'));
  if (!line) return null;
  const raw = line.slice('Готовность:'.length).replace('%', '').trim();
  return /^\d+$/.test(raw) ? Number(raw) : null;
}

function patchOnboardingStatusInNote(note: string, status: CrmOnboardingStatus): string {
  const lines = note.split('\n');
  const start = lines.findIndex((line) => line.trim() === ONBOARDING_HEADER);
  if (start === -1) return note;
  for (let index = start + 1; index < lines.length; index += 1) {
    if (lines[index].trim() === '') break;
    if (lines[index].trim().startsWith('Статус:')) {
      lines[index] = `Статус: ${status}`;
      break;
    }
  }
  return lines.join('\n');
}

function patchChannelManagerHrefInNote(note: string, href: string): string {
  const lines = note.split('\n');
  const start = lines.findIndex((line) => line.trim() === ONBOARDING_HEADER);
  if (start === -1) return note;
  let replaced = false;
  for (let index = start + 1; index < lines.length; index += 1) {
    if (lines[index].trim() === '') break;
    if (lines[index].trim().startsWith('Менеджер каналов:')) {
      lines[index] = `Менеджер каналов: ${href}`;
      replaced = true;
      break;
    }
  }
  if (!replaced) return note;
  return lines.join('\n');
}

function resolveConnectionState(contact: CrmContact, objectId: string): ChannelManagerConnectionState {
  const existing = contact.channelManagerConnection ?? parseChannelManagerConnectionBlock(contact.note);
  if (existing) {
    return {
      ...existing,
      objectId: existing.objectId ?? objectId,
      contactId: existing.contactId ?? contact.id,
    };
  }
  return initialConnectionState({ objectId, contactId: contact.id });
}

async function persistConnection(
  contact: CrmContact,
  state: ChannelManagerConnectionState,
  onboardingStatus?: CrmOnboardingStatus | null,
): Promise<CrmContact> {
  let note = mergeChannelManagerConnectionIntoNote(contact.note, state);
  if (onboardingStatus) {
    note = patchOnboardingStatusInNote(note, onboardingStatus);
    const href = buildChannelManagerConnectionHref({
      objectId: state.objectId ?? '',
      contactId: contact.id,
      source: 'crm_queue',
    });
    note = patchChannelManagerHrefInNote(note, href);
  }
  return updateCrmContact(contact.id, { note });
}

export type ChannelManagerConnectionRequest = {
  contactId: string;
  objectId: string;
  action: ChannelManagerConnectionAction;
  method?: ChannelManagerConnectionMethod;
  access?: ChannelManagerAccessSituation;
  customName?: string;
};

export type ChannelManagerConnectionResult =
  | { ok: true; contact: CrmContact; connection: ChannelManagerConnectionState }
  | { ok: false; status: number; message: string };

export async function handleChannelManagerConnectionAction(
  input: ChannelManagerConnectionRequest,
): Promise<ChannelManagerConnectionResult> {
  const contact = await getCrmContactById(input.contactId);
  if (!contact) {
    return { ok: false, status: 404, message: 'Контакт не найден.' };
  }

  const objectId = input.objectId.trim();
  const noteObjectId = extractObjectIdFromOnboardingNote(contact.note);
  if (!objectId || (noteObjectId && noteObjectId !== objectId)) {
    return { ok: false, status: 400, message: 'Объект не совпадает с CRM-карточкой.' };
  }

  const onboardingStatus = contact.onboarding?.status ?? extractOnboardingStatus(contact.note);
  const readinessPercent = contact.onboarding?.readinessPercent ?? extractReadinessPercent(contact.note);
  const flowContext = {
    objectId,
    contactId: contact.id,
    objectTitle: contact.activeObjectTitle ?? contact.city ?? contact.name,
    readinessPercent,
    onboardingStatus,
  };

  if (!isReadyForChannelManagerFlow(flowContext)) {
    return {
      ok: false,
      status: 403,
      message: 'Объект ещё не готов к подключению Менеджера каналов.',
    };
  }

  let state = resolveConnectionState(contact, objectId);
  let onboardingPatch: CrmOnboardingStatus | null = null;

  switch (input.action) {
    case 'open_flow': {
      state = applyOpenFlow(state);
      onboardingPatch = onboardingStatusAfterConnection(onboardingStatus);
      await emitChannelManagerFlowPrepared({ contactId: contact.id, objectId });
      break;
    }
    case 'select_method': {
      if (!input.method) {
        return { ok: false, status: 400, message: 'Укажите способ подключения.' };
      }
      state = applySelectMethod(state, input.method);
      onboardingPatch = onboardingStatusAfterConnection(onboardingStatus);
      await emitChannelManagerMethodSelected({
        contactId: contact.id,
        objectId,
        method: input.method,
        customManagerName: state.customManagerName,
      });
      if (input.method === 'manual_import' || input.method === 'none_yet') {
        await emitChannelManagerConnectionPrepared({ contactId: contact.id, objectId, method: input.method });
      }
      if (input.method === 'none_yet') {
        await emitChannelManagerNeedsOperator({ contactId: contact.id, objectId, method: input.method });
        await createOpsTaskFromChannelManager({
          contactId: contact.id,
          objectId,
          objectLabel: flowContext.objectTitle,
          ownerName: contact.name,
          method: input.method,
          reason: 'Нужна помощь с первичной настройкой',
        });
      }
      if (input.method === 'other') {
        await createOpsTaskFromChannelManager({
          contactId: contact.id,
          objectId,
          objectLabel: flowContext.objectTitle,
          ownerName: contact.name,
          method: input.method,
          reason: 'Другой Менеджер Каналов',
        });
      }
      break;
    }
    case 'select_access': {
      if (!input.access) {
        return { ok: false, status: 400, message: 'Укажите ситуацию с доступом.' };
      }
      if (!state.method) {
        return { ok: false, status: 400, message: 'Сначала выберите способ подключения.' };
      }
      const selectedMethod = state.method;
      state = applySelectAccess(state, input.access);
      onboardingPatch = onboardingStatusAfterConnection(onboardingStatus);
      await emitChannelManagerAccessRequested({
        contactId: contact.id,
        objectId,
        method: selectedMethod,
        access: input.access,
      });
      if (input.access === 'needs_help') {
        await emitChannelManagerNeedsOperator({ contactId: contact.id, objectId, method: selectedMethod });
        await createOpsTaskFromChannelManager({
          contactId: contact.id,
          objectId,
          objectLabel: flowContext.objectTitle,
          ownerName: contact.name,
          method: selectedMethod,
          reason: 'Нужна помощь с подключением',
        });
      }
      if (input.access === 'has_access') {
        await emitChannelManagerConnectionPrepared({ contactId: contact.id, objectId, method: selectedMethod });
      }
      break;
    }
    case 'set_custom_name': {
      const customName = String(input.customName ?? '').trim();
      if (!customName) {
        return { ok: false, status: 400, message: 'Укажите название менеджера каналов.' };
      }
      state = applyCustomManagerName(state, customName);
      onboardingPatch = onboardingStatusAfterConnection(onboardingStatus);
      await emitChannelManagerMethodSelected({
        contactId: contact.id,
        objectId,
        method: 'other',
        customManagerName: customName,
      });
      await emitChannelManagerConnectionPrepared({ contactId: contact.id, objectId, method: 'other' });
      await createOpsTaskFromChannelManager({
        contactId: contact.id,
        objectId,
        objectLabel: flowContext.objectTitle,
        ownerName: contact.name,
        method: 'other',
        reason: `Другой Менеджер Каналов: ${customName}`,
      });
      break;
    }
    default:
      return { ok: false, status: 400, message: 'Неизвестное действие.' };
  }

  const updated = await persistConnection(contact, state, onboardingPatch);
  return { ok: true, contact: updated, connection: state };
}

export async function loadChannelManagerConnectionContext(params: {
  contactId: string;
  objectId: string;
}): Promise<
  | {
      ok: true;
      contact: CrmContact;
      connection: ChannelManagerConnectionState;
      flowReady: boolean;
      objectTitle: string;
    }
  | { ok: false; status: number; message: string }
> {
  const contact = await getCrmContactById(params.contactId);
  if (!contact) {
    return { ok: false, status: 404, message: 'Контакт не найден.' };
  }

  const onboardingStatus = contact.onboarding?.status ?? extractOnboardingStatus(contact.note);
  const readinessPercent = contact.onboarding?.readinessPercent ?? extractReadinessPercent(contact.note);
  const flowReady = isReadyForChannelManagerFlow({
    objectId: params.objectId,
    contactId: contact.id,
    objectTitle: contact.activeObjectTitle ?? contact.city ?? contact.name,
    readinessPercent,
    onboardingStatus,
  });

  const connection = resolveConnectionState(contact, params.objectId);
  return {
    ok: true,
    contact,
    connection,
    flowReady,
    objectTitle: contact.activeObjectTitle ?? contact.city ?? contact.name,
  };
}