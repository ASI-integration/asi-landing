import type { CrmOnboardingStatus } from '@/lib/crm/types';
import {
  CHANNEL_MANAGER_CONNECTION_METHOD_LABELS,
  CHANNEL_MANAGER_CONNECTION_STATUS_LABELS,
  methodLabel,
} from './labels';
import type {
  ChannelManagerAccessSituation,
  ChannelManagerConnectionMethod,
  ChannelManagerConnectionState,
  ChannelManagerConnectionStatus,
} from './types';

export type ChannelManagerFlowContext = {
  objectId: string;
  contactId: string;
  objectTitle: string;
  readinessPercent: number | null;
  onboardingStatus: CrmOnboardingStatus | null;
};

export function isReadyForChannelManagerFlow(context: ChannelManagerFlowContext): boolean {
  if (context.readinessPercent !== 100) return false;
  return (
    context.onboardingStatus === 'ready_for_channel_manager' ||
    context.onboardingStatus === 'channel_manager_started'
  );
}

export function buildChannelManagerConnectionHref(params: {
  objectId: string;
  contactId?: string | null;
  source: string;
}): string {
  const search = new URLSearchParams({
    objectId: params.objectId,
    source: params.source,
  });
  if (params.contactId) search.set('contactId', params.contactId);
  return `/dashboard/channel-connections?${search.toString()}`;
}

export function initialConnectionState(params: {
  objectId: string;
  contactId: string;
}): ChannelManagerConnectionState {
  return {
    objectId: params.objectId,
    contactId: params.contactId,
    method: null,
    customManagerName: null,
    accessSituation: null,
    status: 'ready_to_connect',
    nextStepRu: 'Выберите способ подключения каналов.',
    updatedAt: null,
  };
}

function providerName(method: ChannelManagerConnectionMethod): string {
  return CHANNEL_MANAGER_CONNECTION_METHOD_LABELS[method];
}

function nextStepAfterMethod(method: ChannelManagerConnectionMethod): {
  status: ChannelManagerConnectionStatus;
  nextStepRu: string;
} {
  switch (method) {
    case 'realtycalendar':
    case 'bnovo':
      return {
        status: 'ready_to_connect',
        nextStepRu: `Уточните доступ к ${providerName(method)}.`,
      };
    case 'manual_import':
      return {
        status: 'prepared',
        nextStepRu: 'ASI начнёт с ручной или полуавтоматической загрузки данных объекта.',
      };
    case 'other':
      return {
        status: 'ready_to_connect',
        nextStepRu: 'Укажите название вашего менеджера каналов.',
      };
    case 'none_yet':
      return {
        status: 'primary_setup_needed',
        nextStepRu: 'Начните с базового контура ASI — оператор поможет с первичной настройкой.',
      };
  }
}

function nextStepAfterAccess(
  method: ChannelManagerConnectionMethod,
  access: ChannelManagerAccessSituation,
): { status: ChannelManagerConnectionStatus; nextStepRu: string } {
  const name = providerName(method);
  switch (access) {
    case 'has_access':
      return {
        status: 'verifying_data',
        nextStepRu: `ASI проверит доступы ${name} и подготовит импорт данных.`,
      };
    case 'from_scratch':
      return {
        status: 'waiting_access',
        nextStepRu: `Ждём доступы ${name}. ASI подскажет, что нужно открыть в кабинете.`,
      };
    case 'needs_help':
      return {
        status: 'needs_operator',
        nextStepRu: `Оператор поможет с подключением ${name}.`,
      };
  }
}

export function applySelectMethod(
  state: ChannelManagerConnectionState,
  method: ChannelManagerConnectionMethod,
): ChannelManagerConnectionState {
  const transition = nextStepAfterMethod(method);
  return {
    ...state,
    method,
    customManagerName: method === 'other' ? state.customManagerName : null,
    accessSituation: method === 'realtycalendar' || method === 'bnovo' ? null : state.accessSituation,
    status: transition.status,
    nextStepRu: transition.nextStepRu,
    updatedAt: new Date().toISOString(),
  };
}

export function applySelectAccess(
  state: ChannelManagerConnectionState,
  access: ChannelManagerAccessSituation,
): ChannelManagerConnectionState {
  if (!state.method || (state.method !== 'realtycalendar' && state.method !== 'bnovo')) {
    return state;
  }
  const transition = nextStepAfterAccess(state.method, access);
  return {
    ...state,
    accessSituation: access,
    status: transition.status,
    nextStepRu: transition.nextStepRu,
    updatedAt: new Date().toISOString(),
  };
}

export function applyCustomManagerName(
  state: ChannelManagerConnectionState,
  customManagerName: string,
): ChannelManagerConnectionState {
  const trimmed = customManagerName.trim();
  if (!trimmed) return state;
  return {
    ...state,
    method: 'other',
    customManagerName: trimmed,
    status: 'prepared',
    nextStepRu: `ASI подготовит подключение через ${trimmed}.`,
    updatedAt: new Date().toISOString(),
  };
}

export function applyOpenFlow(state: ChannelManagerConnectionState): ChannelManagerConnectionState {
  return {
    ...state,
    status: state.method ? state.status : 'ready_to_connect',
    nextStepRu: state.method ? state.nextStepRu : 'Выберите способ подключения каналов.',
    updatedAt: new Date().toISOString(),
  };
}

export function resolveChannelManagerQueueSummary(
  connection: ChannelManagerConnectionState | null | undefined,
  fallbackOnboardingStatus?: CrmOnboardingStatus | null,
): {
  statusLabel: string | null;
  methodLabel: string | null;
  nextStep: string | null;
} {
  if (!connection?.method) {
    if (fallbackOnboardingStatus === 'ready_for_channel_manager') {
      return {
        statusLabel: CHANNEL_MANAGER_CONNECTION_STATUS_LABELS.ready_to_connect,
        methodLabel: null,
        nextStep: 'Открыть Менеджер Каналов и выбрать способ подключения.',
      };
    }
    if (fallbackOnboardingStatus === 'channel_manager_started') {
      return {
        statusLabel: 'Менеджер Каналов открыт',
        methodLabel: null,
        nextStep: 'Выберите способ подключения каналов.',
      };
    }
    return { statusLabel: null, methodLabel: null, nextStep: null };
  }

  const method = methodLabel(connection.method);
  const status = CHANNEL_MANAGER_CONNECTION_STATUS_LABELS[connection.status];

  if (connection.method === 'other' && connection.customManagerName) {
    return {
      statusLabel: `Другой Менеджер Каналов: ${connection.customManagerName}`,
      methodLabel: connection.customManagerName,
      nextStep: connection.nextStepRu,
    };
  }

  if (connection.method === 'none_yet') {
    return {
      statusLabel: CHANNEL_MANAGER_CONNECTION_STATUS_LABELS.primary_setup_needed,
      methodLabel: method,
      nextStep: connection.nextStepRu,
    };
  }

  if (
    connection.status === 'waiting_access' &&
    (connection.method === 'realtycalendar' || connection.method === 'bnovo')
  ) {
    return {
      statusLabel: `Ждём доступы ${providerName(connection.method)}`,
      methodLabel: method,
      nextStep: connection.nextStepRu,
    };
  }

  if (
    connection.status === 'verifying_data' &&
    (connection.method === 'realtycalendar' || connection.method === 'bnovo')
  ) {
    return {
      statusLabel: `Проверяем данные ${providerName(connection.method)}`,
      methodLabel: method,
      nextStep: connection.nextStepRu,
    };
  }

  return {
    statusLabel: status,
    methodLabel: method,
    nextStep: connection.nextStepRu,
  };
}

export function onboardingStatusAfterConnection(
  current: CrmOnboardingStatus | null | undefined,
): CrmOnboardingStatus | null {
  if (current === 'ready_for_channel_manager') return 'channel_manager_started';
  return current ?? null;
}
