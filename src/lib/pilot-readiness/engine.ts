import { crmOperatorAllowlist } from '@/lib/crm/access';
import { normalizeCommunicationMode } from '@/lib/communication/communication-autopilot-settings';
import type {
  PilotObjectSnapshot,
  PilotReadinessCheck,
  PilotReadinessCheckId,
  PilotReadinessResult,
} from './types';
import { PILOT_READINESS_CHECK_LABELS_RU, PILOT_READINESS_CHECKS } from './types';

function text(value: unknown): string {
  return String(value ?? '').trim();
}

function hasOperatorConfigured(): boolean {
  if (process.env.NODE_ENV !== 'production') return true;
  const allowlist = crmOperatorAllowlist();
  if (allowlist.size > 0) return true;
  return false;
}

function evaluateCheck(id: PilotReadinessCheckId, object: PilotObjectSnapshot): PilotReadinessCheck {
  const labelRu = PILOT_READINESS_CHECK_LABELS_RU[id];
  let ok = false;
  let detailRu: string | null = null;

  switch (id) {
    case 'name':
      ok = Boolean(text(object.name));
      detailRu = ok ? null : 'Укажите название объекта';
      break;
    case 'address':
      ok = Boolean(text(object.address));
      detailRu = ok ? null : 'Укажите адрес или район';
      break;
    case 'description':
      ok = Boolean(text(object.description));
      detailRu = ok ? null : 'Добавьте краткое описание для гостей';
      break;
    case 'rules':
      ok = Boolean(text(object.rules));
      detailRu = ok ? null : 'Укажите правила проживания';
      break;
    case 'checkin_checkout':
      ok = Boolean(text(object.checkInTime)) && Boolean(text(object.checkOutTime));
      detailRu = ok ? null : 'Укажите время заезда и выезда';
      break;
    case 'wifi_access':
      ok =
        object.wifiSkipped ||
        Boolean(text(object.wifiName)) ||
        Boolean(text(object.wifiPassword)) ||
        Boolean(text(object.accessNotes)) ||
        Boolean(text(object.checkinInstructions));
      detailRu = ok ? null : 'Добавьте Wi‑Fi или инструкции доступа';
      break;
    case 'photos':
      ok = object.photosDeferred || object.photosCount > 0;
      detailRu = ok ? null : 'Добавьте фото или отметьте, что фото будут позже';
      break;
    case 'channels':
      ok = Boolean(text(object.bookingChannels));
      detailRu = ok ? null : 'Выберите каналы бронирования';
      break;
    case 'communication_mode': {
      const mode = normalizeCommunicationMode(object.communicationMode);
      ok = mode === 'off' || mode === 'manual' || mode === 'autopilot';
      detailRu = ok ? null : 'Выберите режим коммуникации';
      break;
    }
    case 'operator':
      ok = hasOperatorConfigured();
      detailRu = ok ? null : 'Назначьте оператора в CRM_OPERATOR_EMAILS или OPS_ADMIN_EMAILS';
      break;
    default:
      ok = false;
      detailRu = 'Неизвестная проверка';
  }

  return { id, labelRu, ok, detailRu };
}

export function computePilotReadiness(object: PilotObjectSnapshot): PilotReadinessResult {
  const checks = PILOT_READINESS_CHECKS.map((id) => evaluateCheck(id, object));
  const missingCheckIds = checks.filter((check) => !check.ok).map((check) => check.id);

  return {
    propertyId: object.propertyId,
    objectLabel: object.objectLabel,
    ready: missingCheckIds.length === 0,
    checks,
    missingCheckIds,
    missingLabelsRu: missingCheckIds.map((id) => PILOT_READINESS_CHECK_LABELS_RU[id]),
  };
}
