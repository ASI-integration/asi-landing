import { describe, expect, it } from 'vitest';
import { computeObjectGuestReadiness } from '@/lib/property-setup/object-guest-readiness';
import { createEmptySetupData } from '@/lib/property-setup/setup-data';
import {
  filterSetupStepsForGrid,
  formatSetupStepHeader,
  getSetupFillableStepCount,
  isRoutableSetupStepId,
  resolveSetupProgressCounts,
  resolveSetupReadinessPageUi,
  shouldShowSetupNextButton,
  shouldShowTopReadinessBlock,
} from '@/lib/property-setup/setup-readiness-ui';
import type { OpsProperty, PropertyMasterCard } from '@/lib/ops-foundation/types';

const property: OpsProperty = {
  id: 'prop-1',
  accountId: 'acct-1',
  title: 'Тест',
  address: null,
  city: null,
  timezone: 'Europe/Moscow',
  status: 'draft',
  createdAt: '2026-06-16T00:00:00.000Z',
  updatedAt: '2026-06-16T00:00:00.000Z',
};

const masterCard: PropertyMasterCard = {
  id: 'card-1',
  propertyId: 'prop-1',
  publicTitle: null,
  shortDescription: null,
  fullDescription: null,
  amenities: [],
  houseRules: null,
  checkInInstructions: null,
  checkOutInstructions: null,
  wifiName: null,
  wifiPassword: null,
  parkingInfo: null,
  depositInfo: null,
  extraFeesInfo: null,
  cancellationInfo: null,
  guestContactsInfo: null,
  internalNotes: null,
  contentVersion: 1,
  publicationStatus: 'draft',
  createdAt: '2026-06-16T00:00:00.000Z',
  updatedAt: '2026-06-16T00:00:00.000Z',
};

function readySetup() {
  const setup = createEmptySetupData();
  setup.basic.city = 'Казань';
  setup.address.line = 'ул. Баумана, 1';
  setup.checkInOut.checkInInstructions = 'Код 1234';
  setup.wifi.wifiName = 'ASI';
  setup.rules.smoking = 'Запрещено';
  setup.description.full = 'Уютная квартира.';
  return setup;
}

function readyReadiness() {
  return computeObjectGuestReadiness({
    propertyId: 'prop-1',
    property: { ...property, city: 'Казань', address: 'ул. Баумана, 1' },
    masterCard,
    setup: readySetup(),
    media: [
      {
        id: 'photo-1',
        propertyId: 'prop-1',
        url: 'https://example.com/photo.jpg',
        storagePath: null,
        title: null,
        description: null,
        sortOrder: 0,
        isCover: true,
        status: 'active',
        createdAt: '2026-06-16T00:00:00.000Z',
        updatedAt: '2026-06-16T00:00:00.000Z',
      },
    ],
  });
}

const SETUP_SECTION_NAV = [
  { anchor: 'basic', label: 'Основная информация' },
  { anchor: 'address', label: 'Адрес' },
  { anchor: 'units', label: 'Категории/юниты' },
  { anchor: 'photos', label: 'Фото' },
  { anchor: 'description', label: 'Описание' },
  { anchor: 'rules', label: 'Правила проживания' },
  { anchor: 'checkin', label: 'Заезд и выезд' },
  { anchor: 'wifi', label: 'Wi-Fi и инструкции' },
  { anchor: 'pricing', label: 'Цены и базовый тариф' },
  { anchor: 'channels', label: 'Каналы для подключения' },
  { anchor: 'readiness', label: 'Проверка готовности' },
] as const;

const SETUP_STEP_IDS = SETUP_SECTION_NAV.map((item) => item.anchor);

describe('setup readiness page ui', () => {
  it('hides Проверка готовности tile from setup grid', () => {
    const gridSteps = filterSetupStepsForGrid(SETUP_SECTION_NAV);

    expect(gridSteps.map((step) => step.anchor)).not.toContain('readiness');
    expect(gridSteps.map((step) => step.label)).not.toContain('Проверка готовности');
    expect(gridSteps).toHaveLength(SETUP_SECTION_NAV.length - 1);
    expect(getSetupFillableStepCount(SETUP_SECTION_NAV)).toBe(10);
  });

  it('counts only fillable setup sections in progress footer', () => {
    expect(
      resolveSetupProgressCounts({
        completedFillableSections: 7,
        fillableStepCount: getSetupFillableStepCount(SETUP_SECTION_NAV),
      }),
    ).toEqual({ completedStepCount: 7, totalStepCount: 10 });

    expect(
      resolveSetupProgressCounts({
        completedFillableSections: 10,
        fillableStepCount: getSetupFillableStepCount(SETUP_SECTION_NAV),
      }),
    ).toEqual({ completedStepCount: 10, totalStepCount: 10 });
  });

  it('formats readiness header without step index', () => {
    expect(
      formatSetupStepHeader({
        propertyTitle: 'Апартаменты',
        activeStepId: 'readiness',
        activeStepLabel: 'Проверка готовности',
        fillableStepIndex: 0,
        fillableStepCount: 10,
      }),
    ).toBe('Апартаменты · Проверка готовности');

    expect(
      formatSetupStepHeader({
        propertyTitle: 'Апартаменты',
        activeStepId: 'channels',
        activeStepLabel: 'Каналы для подключения',
        fillableStepIndex: 9,
        fillableStepCount: 10,
      }),
    ).toBe('Апартаменты · Шаг 10 из 10: Каналы для подключения');
  });

  it('keeps readiness step routable via ?step=readiness', () => {
    expect(isRoutableSetupStepId('readiness', SETUP_STEP_IDS)).toBe(true);
    expect(SETUP_SECTION_NAV.find((step) => step.anchor === 'readiness')?.label).toBe(
      'Проверка готовности',
    );
  });

  it('hides Далее on readiness step', () => {
    expect(shouldShowSetupNextButton('readiness')).toBe(false);
    expect(shouldShowSetupNextButton('channels')).toBe(true);

    const ui = resolveSetupReadinessPageUi({
      activeStepId: 'readiness',
      readiness: readyReadiness(),
      telegramLinked: false,
      guestTestDispatched: false,
    });

    expect(ui.showNextButton).toBe(false);
  });

  it('shows only one main CTA on readiness step', () => {
    const ui = resolveSetupReadinessPageUi({
      activeStepId: 'readiness',
      readiness: readyReadiness(),
      telegramLinked: false,
      guestTestDispatched: false,
    });

    expect(ui.primaryCtaPlacements).toEqual(['sticky']);
    expect(ui.readinessBlockShowPrimaryCta).toBe(false);
    expect(ui.stickyShowsPrimaryCta).toBe(true);
    expect(ui.stickyPrimaryCta?.label).toBe('Подключить Telegram и запустить тест');
  });

  it('does not duplicate readiness block on readiness step', () => {
    expect(shouldShowTopReadinessBlock('readiness')).toBe(false);
    expect(shouldShowTopReadinessBlock('basic')).toBe(true);

    const ui = resolveSetupReadinessPageUi({
      activeStepId: 'readiness',
      readiness: readyReadiness(),
      telegramLinked: false,
      guestTestDispatched: false,
    });

    expect(ui.showTopReadinessBlock).toBe(false);
  });

  it('routes sticky CTA to missing section before 7/7', () => {
    const readiness = computeObjectGuestReadiness({
      propertyId: 'prop-1',
      property,
      masterCard,
      setup: createEmptySetupData(),
      media: [],
    });

    const ui = resolveSetupReadinessPageUi({
      activeStepId: 'readiness',
      readiness,
      telegramLinked: false,
      guestTestDispatched: false,
    });

    expect(ui.stickyPrimaryCta?.kind).toBe('setup_step');
    expect(ui.stickyPrimaryCta?.label).toBe('Заполнить: Город');
    expect(ui.stickyPrimaryCta?.setupStep).toBe('basic');
  });

  it('routes sticky CTA to telegram deep link at 7/7', () => {
    const ui = resolveSetupReadinessPageUi({
      activeStepId: 'readiness',
      readiness: readyReadiness(),
      telegramLinked: false,
      guestTestDispatched: false,
    });

    expect(ui.stickyPrimaryCta?.kind).toBe('external');
    expect(ui.stickyPrimaryCta?.href).toContain('guest_test_prop-1');
  });

  it('shows open telegram sticky CTA after guest test is dispatched', () => {
    const ui = resolveSetupReadinessPageUi({
      activeStepId: 'readiness',
      readiness: readyReadiness(),
      telegramLinked: true,
      guestTestDispatched: true,
    });

    expect(ui.stickyPrimaryCta?.label).toBe('Открыть Telegram');
    expect(ui.stickyPrimaryCta?.href).toMatch(/^https:\/\/t\.me\//);
  });
});
