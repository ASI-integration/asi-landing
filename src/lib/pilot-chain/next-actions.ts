import { isReadyForChannelManagerFlow } from '@/lib/channel-manager-connection/flow';
import type { CrmContact } from '@/lib/crm/types';
import { computeObjectReadiness } from '@/lib/object-readiness/engine';
import { shouldAutoProvisionObjectFromLead } from './status-triggers';
import {
  buildChannelManagerHrefForContact,
  buildObjectSetupHref,
  buildOpsBoardHref,
  extractLinkedObjectId,
  readinessInputFromContact,
} from './note-blocks';
import type { PilotChainNextAction } from './types';

export function resolvePilotChainNextActions(
  contact: CrmContact,
  options?: { opsTaskId?: string | null },
): PilotChainNextAction[] {
  const objectId = extractLinkedObjectId(contact);
  const actions: PilotChainNextAction[] = [];
  const canAutoCreate = shouldAutoProvisionObjectFromLead(contact.status);

  if (!objectId) {
    actions.push({
      key: 'create_object',
      labelRu: canAutoCreate ? 'Создать объект' : 'Объект ещё не создан',
      href: null,
      done: false,
    });
    return actions;
  }

  actions.push({
    key: 'object_created',
    labelRu: 'Объект создан',
    href: null,
    done: true,
  });

  actions.push({
    key: 'open_object_setup',
    labelRu: 'Открыть настройку объекта',
    href: buildObjectSetupHref(objectId),
    done: false,
  });

  const readiness = computeObjectReadiness(readinessInputFromContact(contact));
  const cmHref =
    contact.onboarding?.channelManagerHref ?? buildChannelManagerHrefForContact(contact.id, objectId);
  const flowReady = isReadyForChannelManagerFlow({
    objectId,
    contactId: contact.id,
    objectTitle: contact.activeObjectTitle ?? contact.name,
    readinessPercent: readiness.readiness_percent,
    onboardingStatus: contact.onboarding?.status ?? null,
  });

  if (flowReady || contact.channelManagerConnection?.method) {
    actions.push({
      key: 'open_channel_manager',
      labelRu: 'Открыть менеджер каналов',
      href: cmHref,
      done: contact.onboarding?.status === 'channel_manager_started',
    });
  } else if (readiness.missing_required_fields.length > 0) {
    actions.push({
      key: 'open_channel_manager',
      labelRu: `Дальше: ${readiness.next_best_step_ru}`,
      href: buildObjectSetupHref(objectId),
      done: false,
    });
  }

  if (options?.opsTaskId || flowReady) {
    actions.push({
      key: 'open_ops',
      labelRu: 'Открыть OPS',
      href: buildOpsBoardHref(),
      done: false,
    });
  }

  return actions;
}
