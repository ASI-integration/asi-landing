import { describe, expect, it } from 'vitest';
import type { OpsProperty, PropertyMasterCard, PropertyMedia } from '@/lib/ops-foundation/types';
import { createEmptySetupData } from '@/lib/property-setup/setup-data';
import { buildPropertyPassportModel } from '../property-passport';

const property: OpsProperty = {
  id: 'prop-1',
  accountId: 'acct-1',
  title: 'Апартаменты у парка',
  address: 'ул. Лесная, 10',
  city: 'Москва',
  timezone: 'Europe/Moscow',
  status: 'draft',
  createdAt: '2026-01-01T00:00:00.000Z',
  updatedAt: '2026-01-01T00:00:00.000Z',
};

const masterCard: PropertyMasterCard = {
  id: 'card-1',
  propertyId: 'prop-1',
  publicTitle: 'Парк Апарт',
  shortDescription: 'Короткое описание',
  fullDescription: 'Полное описание из мастер-карточки',
  amenities: [],
  houseRules: 'Не курить',
  checkInInstructions: 'Ключи в сейфе',
  checkOutInstructions: 'Закройте дверь',
  wifiName: 'ParkWifi',
  wifiPassword: 'secret',
  parkingInfo: null,
  depositInfo: '5000 ₽',
  extraFeesInfo: null,
  cancellationInfo: null,
  guestContactsInfo: null,
  internalNotes: null,
  contentVersion: 1,
  publicationStatus: 'draft',
  createdAt: '2026-01-01T00:00:00.000Z',
  updatedAt: '2026-01-01T00:00:00.000Z',
};

const media: PropertyMedia[] = [
  {
    id: 'photo-1',
    propertyId: 'prop-1',
    url: 'https://example.com/1.jpg',
    storagePath: null,
    title: 'Гостиная',
    description: null,
    sortOrder: 1,
    isCover: false,
    status: 'active',
    createdAt: '2026-01-01T00:00:00.000Z',
    updatedAt: '2026-01-01T00:00:00.000Z',
  },
  {
    id: 'photo-2',
    propertyId: 'prop-1',
    url: 'https://example.com/2.jpg',
    storagePath: null,
    title: 'Спальня',
    description: null,
    sortOrder: 2,
    isCover: true,
    status: 'active',
    createdAt: '2026-01-01T00:00:00.000Z',
    updatedAt: '2026-01-01T00:00:00.000Z',
  },
];

describe('buildPropertyPassportModel', () => {
  it('builds preview fields, cover photo, thumbnails and selected channels', () => {
    const setup = createEmptySetupData();
    setup.basic.title = 'Солнечная квартира';
    setup.basic.city = 'Сочи';
    setup.address.line = 'Морская, 5';
    setup.description.full = 'Светлая квартира рядом с морем.';
    setup.rules.smoking = 'Запрещено';
    setup.checkInOut.checkInTime = '15:00';
    setup.checkInOut.checkOutTime = '12:00';
    setup.wifi.wifiName = 'SunWifi';
    setup.pricing.basePricePerNight = '7000';
    setup.channels[0].status = 'preparing';

    const model = buildPropertyPassportModel({ property, masterCard, setup, media });

    expect(model.title).toBe('Солнечная квартира');
    expect(model.location).toBe('Сочи · Морская, 5');
    expect(model.coverPhoto?.id).toBe('photo-2');
    expect(model.thumbnailPhotos.map((item) => item.id)).toEqual(['photo-1']);
    expect(model.selectedChannels).toEqual([
      { code: 'yandex_travel', label: 'Яндекс Путешествия', statusLabel: 'Готовится' },
    ]);
    expect(model.pricing).toContain('Базовая цена за ночь: 7000 ₽');
    expect(model.completedCount).toBe(9);
    expect(model.isReady).toBe(true);
  });

  it('keeps missing items actionable with setup links', () => {
    const setup = createEmptySetupData();
    setup.basic.title = 'Черновик';

    const model = buildPropertyPassportModel({ property, masterCard: null, setup, media: [] });

    expect(model.coverPhoto).toBeNull();
    expect(model.isReady).toBe(false);
    expect(model.readinessItems.find((item) => item.id === 'photos')).toMatchObject({
      done: false,
      hint: 'Добавьте главное фото и остальные снимки объекта.',
      actionHref: '/dashboard/properties/prop-1/setup?step=photos',
    });
    expect(model.readinessItems.find((item) => item.id === 'channels')).toMatchObject({
      done: false,
      actionLabel: 'Выбрать каналы',
    });
  });
});
