import { channelManagerDisplayName } from '@/lib/channel-manager/registry';
import type { TelegramInlineKeyboardMarkup } from './communication-identity-routing';
import type { OwnerOnboardingState } from './telegram-owner-onboarding';
import type { MkResponsibleRole } from '@/lib/channel-manager-connection/types';

const MK_CALLBACK_PREFIX = 'obmk:';

export const MK_STATUS_CALLBACK_DATA = `${MK_CALLBACK_PREFIX}status`;
export const MK_COPY_INSTRUCTION_CALLBACK_DATA = `${MK_CALLBACK_PREFIX}copy_inst`;
export const MK_CHANGE_RESPONSIBLE_CALLBACK_DATA = `${MK_CALLBACK_PREFIX}change_resp`;
export const MK_CALL_OPERATOR_CALLBACK_DATA = `${MK_CALLBACK_PREFIX}call_operator`;

const INSTRUCTION_ROLES: MkResponsibleRole[] = ['owner', 'manager', 'administrator', 'staff'];

function mkResponsibleRoleLabel(role: MkResponsibleRole | null | undefined): string {
  switch (role) {
    case 'owner':
      return 'владелец';
    case 'manager':
      return 'управляющий';
    case 'administrator':
      return 'администратор';
    case 'staff':
      return 'другой сотрудник';
    default:
      return 'ответственный';
  }
}

function text(value: unknown, max = 600): string {
  return String(value ?? '').trim().slice(0, max);
}

export function hasMkResponsibleInstruction(state: OwnerOnboardingState): boolean {
  const role = state.mk_responsible_role;
  return Boolean(role && INSTRUCTION_ROLES.includes(role));
}

function mkBranchContext(state: OwnerOnboardingState): string {
  const cmLabel = channelManagerDisplayName(state.selected_channel_manager);
  if (state.mk_route === 'has_cm' && cmLabel) {
    return `Используется менеджер каналов: ${cmLabel}. Проверьте, можно ли подключить ASI к этому менеджеру каналов.`;
  }
  if (state.mk_route === 'has_cm') {
    return 'Проверьте, можно ли подключить ASI к используемому менеджеру каналов.';
  }
  if (state.mk_route === 'no_cm') {
    return 'Нужно выбрать подходящий менеджер каналов для объекта.';
  }
  if (state.mk_route === 'unknown_cm' || state.mk_route === 'unknown_help') {
    return 'Нужно помочь определить, используется ли уже менеджер каналов, или выбрать подходящий вариант.';
  }
  return 'Нужно уточнить, какой менеджер каналов используется или будет использоваться.';
}

function buildInstructionSteps(state: OwnerOnboardingState): string[] {
  const cmLabel = channelManagerDisplayName(state.selected_channel_manager);
  const steps: string[] = [];

  if (state.mk_route === 'has_cm' && cmLabel) {
    steps.push(`Проверить, добавлен ли объект в менеджере каналов ${cmLabel}.`);
  } else if (state.mk_route === 'no_cm') {
    steps.push('Выбрать подходящий менеджер каналов для объекта.');
    steps.push('Проверить, добавлен ли объект в выбранном менеджере каналов.');
  } else if (state.mk_route === 'unknown_cm' || state.mk_route === 'unknown_help') {
    steps.push('Определить, используется ли уже менеджер каналов, или выбрать подходящий вариант.');
    steps.push('Проверить, добавлен ли объект в менеджере каналов.');
  } else {
    steps.push('Уточнить, какой менеджер каналов используется или будет использоваться.');
    steps.push('Проверить, добавлен ли объект в менеджере каналов.');
  }

  if (state.mk_route === 'has_cm') {
    if (state.property_in_channel_manager === 'no') {
      steps.push('Если объект ещё не добавлен, добавить его по подготовленным данным.');
    } else if (state.property_in_channel_manager === 'unknown') {
      steps.push('Если объект ещё не добавлен, добавить его по подготовленным данным.');
    }
  } else if (state.mk_route !== 'no_cm') {
    steps.push('Если объект ещё не добавлен, добавить его по подготовленным данным.');
  } else {
    steps.push('Если объект ещё не добавлен, добавить его по подготовленным данным.');
  }

  steps.push('Проверить, какие площадки бронирования подключены через менеджер каналов.');
  steps.push('Сообщить владельцу или оператору ASI, когда подключение готово или где возникла проблема.');

  return steps.map((step, index) => `${index + 1}. ${step}`);
}

export function buildMkResponsibleInstructionText(state: OwnerOnboardingState): string {
  const context = mkBranchContext(state);
  const steps = buildInstructionSteps(state);
  return [
    'Инструкция по подключению ASI к менеджеру каналов',
    '',
    'Вы назначены ответственным за подключение объекта.',
    '',
    context,
    '',
    'Что нужно сделать:',
    ...steps,
    '',
    'Важно:',
    'Не отправляйте логины и пароли в Telegram.',
    'Если понадобится доступ, оператор подскажет безопасный способ передачи.',
  ].join('\n');
}

export function buildMkResponsibleInstructionSummary(state: OwnerOnboardingState): string {
  const cmLabel = channelManagerDisplayName(state.selected_channel_manager);
  const route = state.mk_route;
  if (route === 'has_cm' && cmLabel) {
    return `Инструкция для ответственного: проверить подключение ASI к ${cmLabel}.`;
  }
  if (route === 'no_cm') {
    return 'Инструкция для ответственного: выбрать менеджер каналов и подготовить объект.';
  }
  if (route === 'unknown_cm' || route === 'unknown_help') {
    return 'Инструкция для ответственного: определить менеджер каналов и проверить подключение.';
  }
  return 'Инструкция для ответственного по подключению менеджера каналов.';
}

export function buildMkResponsibleSavedOwnerMessage(state: OwnerOnboardingState): string {
  return [
    'Поняла. Ответственный сохранён.',
    '',
    'Ниже инструкция для ответственного. Её можно переслать управляющему или администратору.',
    '',
    buildMkResponsibleInstructionText(state),
  ].join('\n');
}

export function buildMkResponsibleInstructionMarkup(): TelegramInlineKeyboardMarkup {
  return {
    inline_keyboard: [
      [{ text: 'Скопировать инструкцию', callback_data: MK_COPY_INSTRUCTION_CALLBACK_DATA }],
      [{ text: 'Статус подключения', callback_data: MK_STATUS_CALLBACK_DATA }],
      [{ text: 'Изменить ответственного', callback_data: MK_CHANGE_RESPONSIBLE_CALLBACK_DATA }],
      [{ text: 'Позвать оператора', callback_data: MK_CALL_OPERATOR_CALLBACK_DATA }],
    ],
  };
}

export function buildMkResponsibleStatusMessage(state: OwnerOnboardingState): string {
  const contact = text(state.mk_responsible_contact, 160);
  const responsible = [mkResponsibleRoleLabel(state.mk_responsible_role), contact].filter(Boolean).join(', ');
  return [
    'Данные объекта собраны.',
    '',
    `Ответственный за подключение: ${responsible}.`,
    'Инструкция для ответственного подготовлена.',
    '',
    'Следующий шаг: ответственный проверяет подключение менеджера каналов. Если понадобится доступ или подтверждение, оператор подскажет безопасный способ передачи.',
  ].join('\n');
}

export function buildMkResponsibleCopyIntroMessage(): string {
  return 'Скопируйте сообщение ниже и отправьте ответственному.';
}

export function buildMkResponsibleCallOperatorMessage(): string {
  return 'Поняла, передам вопрос оператору ASI. Он подключится здесь, как будет готов.';
}
