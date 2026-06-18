import { describe, expect, it } from 'vitest';
import { computeObjectGuestReadiness } from '@/lib/property-setup/object-guest-readiness';
import { createEmptySetupData } from '@/lib/property-setup/setup-data';
import { resolveSetupNextStep } from '@/lib/property-setup/setup-next-step';
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

describe('setup next step flow', () => {
  it('hides telegram CTA before guest readiness is complete', () => {
    const readiness = computeObjectGuestReadiness({
      propertyId: 'prop-1',
      property,
      masterCard,
      setup: createEmptySetupData(),
      media: [],
    });

    const step = resolveSetupNextStep({
      readiness,
      telegramLinked: false,
      guestTestDispatched: false,
      onSetupPage: true,
    });

    expect(step.phase).toBe('filling');
    expect(step.hidePilotTelegramCta).toBe(true);
    expect(step.showTelegramFallback).toBe(false);
    expect(step.guestTestCommand).toBeNull();
    expect(step.primaryCta.label).toBe('Заполнить: Город');
    expect(step.primaryCta.kind).toBe('setup_step');
  });

  it('shows single connect telegram CTA when readiness is 7/7', () => {
    const setup = createEmptySetupData();
    setup.basic.city = 'Казань';
    setup.address.line = 'ул. Баумана, 1';
    setup.checkInOut.checkInInstructions = 'Код 1234';
    setup.wifi.wifiName = 'ASI';
    setup.rules.smoking = 'Запрещено';
    setup.description.full = 'Уютная квартира.';

    const readiness = computeObjectGuestReadiness({
      propertyId: 'prop-1',
      property: { ...property, city: 'Казань', address: 'ул. Баумана, 1' },
      masterCard,
      setup,
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

    const step = resolveSetupNextStep({
      readiness,
      telegramLinked: false,
      guestTestDispatched: false,
      onSetupPage: true,
    });

    expect(readiness.isReady).toBe(true);
    expect(step.phase).toBe('launch_guest_test');
    expect(step.primaryCta.label).toBe('Запустить тест гостя в Telegram');
    expect(step.primaryCta.kind).toBe('launch_guest_test');
    expect(step.hidePilotTelegramCta).toBe(true);
    expect(step.showTelegramFallback).toBe(true);
    expect(step.guestTestCommand).toBe('/guest_test prop-1');
  });

  it('shows open telegram CTA after guest test is dispatched', () => {
    const setup = createEmptySetupData();
    setup.basic.city = 'Казань';
    setup.address.line = 'ул. Баумана, 1';
    setup.checkInOut.checkInInstructions = 'Код 1234';
    setup.wifi.wifiName = 'ASI';
    setup.rules.smoking = 'Запрещено';
    setup.description.full = 'Уютная квартира.';

    const readiness = computeObjectGuestReadiness({
      propertyId: 'prop-1',
      property: { ...property, city: 'Казань', address: 'ул. Баумана, 1' },
      masterCard,
      setup,
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

    const step = resolveSetupNextStep({
      readiness,
      telegramLinked: true,
      guestTestDispatched: true,
      onSetupPage: true,
    });

    expect(step.phase).toBe('guest_test_started');
    expect(step.statusMessage).toContain('Тест гостя запущен');
    expect(step.primaryCta.label).toBe('Открыть Telegram');
    expect(step.secondaryCta?.label).toBe('Перезапустить тест гостя в Telegram');
  });
});
