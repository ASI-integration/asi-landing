import { describe, expect, it } from 'vitest';
import {
  buildMkResponsibleCopyIntroMessage,
  buildMkResponsibleInstructionText,
  buildMkResponsibleSavedOwnerMessage,
  buildMkResponsibleStatusMessage,
  hasMkResponsibleInstruction,
  MK_COPY_INSTRUCTION_CALLBACK_DATA,
} from '../mk-responsible-instruction';
import type { OwnerOnboardingState } from '../telegram-owner-onboarding';

function baseState(partial: Partial<OwnerOnboardingState> = {}): OwnerOnboardingState {
  return {
    clarification_attempts: 0,
    status: 'ready_for_channel_manager',
    missing: [],
    lastMessage: '',
    channelManagerHref: '/dashboard/channel-connections',
    mk_route: 'has_cm',
    selected_channel_manager: 'bnovo',
    property_in_channel_manager: 'yes',
    mk_responsible_role: 'manager',
    mk_responsible_contact: '@manager_nevsky',
    ...partial,
  } as OwnerOnboardingState;
}

describe('mk responsible instruction', () => {
  it('generates instruction for existing MK branch with selected manager', () => {
    const text = buildMkResponsibleInstructionText(baseState());
    expect(text).toContain('Инструкция по подключению ASI к менеджеру каналов');
    expect(text).toContain('Bnovo');
    expect(text).toContain('Проверьте, можно ли подключить ASI к этому менеджеру каналов');
    expect(text).toContain('Не отправляйте логины и пароли в Telegram');
    expect(text).not.toMatch(/CRM|OPS|API|audit/i);
  });

  it('generates instruction for no MK branch', () => {
    const text = buildMkResponsibleInstructionText(
      baseState({
        mk_route: 'no_cm',
        selected_channel_manager: undefined,
        property_in_channel_manager: undefined,
      }),
    );
    expect(text).toContain('Нужно выбрать подходящий менеджер каналов для объекта');
  });

  it('generates instruction for unknown MK branch', () => {
    const text = buildMkResponsibleInstructionText(
      baseState({
        mk_route: 'unknown_help',
        selected_channel_manager: undefined,
      }),
    );
    expect(text).toContain('Нужно помочь определить, используется ли уже менеджер каналов');
  });

  it('builds saved owner message with intro and instruction', () => {
    const message = buildMkResponsibleSavedOwnerMessage(baseState());
    expect(message).toContain('Поняла. Ответственный сохранён.');
    expect(message).toContain('Ниже инструкция для ответственного');
    expect(message).toContain('Инструкция по подключению ASI к менеджеру каналов');
  });

  it('detects instruction-ready responsible roles', () => {
    expect(hasMkResponsibleInstruction(baseState({ mk_responsible_role: 'manager' }))).toBe(true);
    expect(hasMkResponsibleInstruction(baseState({ mk_responsible_role: 'unknown' }))).toBe(false);
    expect(hasMkResponsibleInstruction(baseState({ mk_responsible_role: 'asi_help' }))).toBe(false);
  });

  it('builds status message with instruction prepared', () => {
    const status = buildMkResponsibleStatusMessage(baseState());
    expect(status).toContain('Данные объекта собраны');
    expect(status).toContain('Ответственный за подключение: управляющий, @manager_nevsky');
    expect(status).toContain('Инструкция для ответственного подготовлена');
    expect(status).toContain('ответственный проверяет подключение менеджера каналов');
  });

  it('uses copy callback data and intro for copy flow', () => {
    expect(MK_COPY_INSTRUCTION_CALLBACK_DATA).toBe('obmk:copy_inst');
    expect(buildMkResponsibleCopyIntroMessage()).toBe(
      'Скопируйте сообщение ниже и отправьте ответственному.',
    );
  });
});
