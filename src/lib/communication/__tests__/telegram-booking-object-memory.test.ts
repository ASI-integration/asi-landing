import { describe, it, expect } from 'vitest';
import {
  bookingObjectContextToAutopilotFields,
  composeGuestCheckoutReplyRu,
  composeGuestDirectionsReplyRu,
  composeGuestParkingReplyRu,
  composeGuestWifiReplyRu,
  get_wifi_info_if_verified,
  lookup_booking_by_identifier,
  lookup_booking_by_telegram,
  lookup_property_by_booking,
  resolveTelegramGuestBookingObjectContext,
  type TelegramGuestBookingV1,
  type TelegramPropertyObjectV1,
} from '../telegram-booking-object-memory';
import { decideCommunicationAutopilotResponse } from '../autopilot';

const TEST_PROPERTY: TelegramPropertyObjectV1 = {
  object_id: 'test-prop-tg-live',
  object_name: 'Тестовая квартира ASI',
  address: 'Санкт-Петербург, Невский проспект, 24',
  directions_text: 'Вход со двора, лифт на 3 этаж, квартира 12.',
  parking_text: 'Парковка во дворе бесплатная для гостей.',
  trash_bins_location: null,
  waste_disposal_text: null,
  wifi_name: 'ASI-Nevsky24-Guest',
  wifi_password: 'test-wifi-nevsky24',
  baby_crib_available: null,
  baby_crib_note: null,
  check_in_text: 'Заезд с 15:00.',
  checkout_time: '12:00',
  house_rules_text: 'Тишина после 22:00.',
  door_code_notes: 'Код домофона 4829*',
};

const TEST_BOOKING: TelegramGuestBookingV1 = {
  booking_id: 'BK-TEST-TG-001',
  reservation_id: 'test-res-tg-live',
  guest_name: 'Тестовый Гость',
  guest_phone: '79991234567',
  telegram_chat_id: 920001,
  object_id: 'test-prop-tg-live',
  check_in_date: '2026-05-30',
  check_out_date: '2026-06-02',
  status: 'confirmed',
  access_verified: true,
};

function makeDb(seed: {
  properties?: any[];
  objectKnowledgeEntries?: any[];
  reservations?: any[];
  identities?: any[];
  profiles?: any[];
  suspicious?: any[];
}) {
  const rows: Record<string, any[]> = {
    tg_property_knowledge: seed.properties ?? [],
    object_knowledge_entries: seed.objectKnowledgeEntries ?? [],
    tg_guest_reservations: seed.reservations ?? [],
    tg_guest_identities: seed.identities ?? [],
    tg_guest_profiles: seed.profiles ?? [],
    tg_suspicious_users: seed.suspicious ?? [],
  };

  const db = {
    from: (table: string) => {
      const q: any = {
        _table: table,
        _filters: [] as Array<{ col: string; val: any; in?: boolean }>,
        _limit: null as number | null,
        _order: null as { col: string; asc: boolean } | null,
        select: () => q,
        ilike: () => q,
        in: (col: string, vals: any[]) => {
          q._filters.push({ col, val: vals, in: true });
          return q;
        },
        gte: () => q,
        lte: () => q,
        order: (col: string, opts?: { ascending?: boolean }) => {
          q._order = { col, asc: opts?.ascending !== false };
          return q;
        },
        limit: (n: number) => {
          q._limit = n;
          return q;
        },
        eq: (col: string, val: any) => {
          q._filters.push({ col, val });
          return q;
        },
        maybeSingle: async () => {
          const data = materialize(q);
          return { data: data[0] ?? null, error: null };
        },
        then: (resolve: any, reject: any) =>
          Promise.resolve({ data: materialize(q), error: null }).then(resolve, reject),
      };
      return q;
    },
  };

  return db;

  function materialize(q: any): any[] {
    let data = [...(rows[q._table] ?? [])];
    for (const filter of q._filters) {
      if (filter.in) {
        const vals = new Set((filter.val ?? []).map((v: any) => String(v)));
        data = data.filter((row) => vals.has(String(row[filter.col] ?? '')));
      } else {
        data = data.filter((row) => String(row[filter.col] ?? '') === String(filter.val));
      }
    }
    if (q._order) {
      data.sort((a, b) => {
        const av = String(a[q._order.col] ?? '');
        const bv = String(b[q._order.col] ?? '');
        return q._order.asc ? av.localeCompare(bv) : bv.localeCompare(av);
      });
    }
    if (typeof q._limit === 'number') data = data.slice(0, q._limit);
    return data;
  }
}

function propertyRowFromFixture() {
  return {
    property_id: TEST_PROPERTY.object_id,
    object_name: TEST_PROPERTY.object_name,
    address: TEST_PROPERTY.address,
    location: 'Невский 24',
    directions_text: TEST_PROPERTY.directions_text,
    parking_text: TEST_PROPERTY.parking_text,
    wifi_name: TEST_PROPERTY.wifi_name,
    wifi_password: TEST_PROPERTY.wifi_password,
    check_in_text: TEST_PROPERTY.check_in_text,
    check_out_time: TEST_PROPERTY.checkout_time,
    house_rules_text: TEST_PROPERTY.house_rules_text,
    door_code_notes: TEST_PROPERTY.door_code_notes,
  };
}

function reservationRowFromFixture(overrides: Partial<any> = {}) {
  return {
    id: TEST_BOOKING.reservation_id,
    booking_id: TEST_BOOKING.booking_id,
    property_id: TEST_BOOKING.object_id,
    guest_id: 'test-guest-tg-live',
    guest_name: TEST_BOOKING.guest_name,
    phone: TEST_BOOKING.guest_phone,
    guest_phone: TEST_BOOKING.guest_phone,
    chat_id: TEST_BOOKING.telegram_chat_id,
    check_in: `${TEST_BOOKING.check_in_date}T12:00:00.000Z`,
    check_out: `${TEST_BOOKING.check_out_date}T12:00:00.000Z`,
    status: 'confirmed',
    access_verified: true,
    access_verified_at: '2026-05-30T10:00:00.000Z',
    ...overrides,
  };
}

describe('telegram booking/object memory layer', () => {
  it('routes directions with linked Telegram booking', async () => {
    const db = makeDb({
      properties: [propertyRowFromFixture()],
      reservations: [reservationRowFromFixture()],
      identities: [
        {
          guest_id: 'test-guest-tg-live',
          telegram_chat_id: 920001,
          phone: TEST_BOOKING.guest_phone,
          first_name: 'Тест',
        },
      ],
    });

    const ctx = await resolveTelegramGuestBookingObjectContext({
      telegram_chat_id: 920001,
      text: 'Как добраться до квартиры?',
      db,
    });

    expect(ctx.booking_resolved).toBe(true);
    expect(ctx.property_resolved).toBe(true);
    const reply = composeGuestDirectionsReplyRu(ctx.property);
    expect(reply).toMatch(/Невский проспект, 24/);
    expect(reply).toMatch(/Вход со двора/);

    const autopilot = decideCommunicationAutopilotResponse({
      channel: 'telegram',
      messageText: 'Как добраться до квартиры?',
      context: bookingObjectContextToAutopilotFields(ctx) as any,
    });
    expect(autopilot.action).toBe('auto_reply');
    expect(autopilot.replyText).toMatch(/Невский проспект, 24/);
  });

  it('asks for booking details when Telegram chat has no linked booking', async () => {
    const db = makeDb({ properties: [propertyRowFromFixture()], reservations: [] });

    const ctx = await resolveTelegramGuestBookingObjectContext({
      telegram_chat_id: 999999,
      text: 'Как добраться до квартиры?',
      db,
    });

    expect(ctx.booking_resolved).toBe(false);
    expect(ctx.property_resolved).toBe(false);

    const autopilot = decideCommunicationAutopilotResponse({
      channel: 'telegram',
      messageText: 'Как добраться до квартиры?',
      context: bookingObjectContextToAutopilotFields(ctx) as any,
    });
    expect(autopilot.action).toBe('needs_context');
    expect(autopilot.replyText).toMatch(/номер бронирования|адрес объекта/i);
  });

  it('returns Wi-Fi for verified booking', async () => {
    const db = makeDb({
      properties: [propertyRowFromFixture()],
      reservations: [reservationRowFromFixture()],
      identities: [
        {
          guest_id: 'test-guest-tg-live',
          telegram_chat_id: 920001,
          phone: TEST_BOOKING.guest_phone,
        },
      ],
    });

    const ctx = await resolveTelegramGuestBookingObjectContext({
      telegram_chat_id: 920001,
      text: 'Какой пароль от Wi-Fi?',
      db,
    });

    expect(ctx.wifi_verified).toBe(true);
    const wifi = get_wifi_info_if_verified({ property: ctx.property, verified: ctx.wifi_verified });
    expect(wifi?.wifi_name).toBe('ASI-Nevsky24-Guest');
    expect(wifi?.wifi_password).toBe('test-wifi-nevsky24');

    const reply = composeGuestWifiReplyRu({ property: ctx.property, verified: ctx.wifi_verified });
    expect(reply).toMatch(/ASI-Nevsky24-Guest/);
    expect(reply).toMatch(/test-wifi-nevsky24/);
  });

  it('merges partial object knowledge with tg_property_knowledge fallback', async () => {
    const db = makeDb({
      properties: [
        {
          ...propertyRowFromFixture(),
          property_id: 'prop_A',
          object_name: 'Тестовый объект Communication Autopilot',
          wifi_name: 'ASI-Test-WiFi',
          wifi_password: 'test12345',
          parking_text: 'парковка во дворе по возможности, место не гарантируется',
          check_in_text: 'после 14:00; бесконтактное заселение',
          communication_autopilot: 'enabled',
        },
      ],
      objectKnowledgeEntries: [
        {
          object_id: 'prop_A',
          category: 'waste',
          key: 'trash_bins_location',
          value_text: 'Мусорные баки находятся во дворе.',
          visibility: 'guest_public',
          sensitivity: 'normal',
          confidence: 'high',
          updated_at: '2026-06-02T17:43:43.431928+00:00',
        },
      ],
      reservations: [
        reservationRowFromFixture({
          id: 'ASI-LIVE-PROP-A',
          property_id: 'prop_A',
          chat_id: 931919812,
          guest_id: 'tg_931919812',
        }),
      ],
    });

    const ctx = await resolveTelegramGuestBookingObjectContext({
      telegram_chat_id: 931919812,
      text: 'Какой Wi-Fi?',
      db,
    });

    expect(ctx.property?.object_id).toBe('prop_A');
    expect(ctx.property?.trash_bins_location).toMatch(/Мусорные баки/);
    expect(ctx.property?.wifi_name).toBe('ASI-Test-WiFi');
    expect(ctx.property?.wifi_password).toBe('test12345');
    expect(ctx.property?.parking_text).toMatch(/парковка во дворе/);
    expect(ctx.property?.check_in_text).toMatch(/после 14:00/);
    expect(ctx.property?.communication_autopilot).toBe('enabled');
  });

  it('does not return Wi-Fi without verified booking', async () => {
    const db = makeDb({
      properties: [propertyRowFromFixture()],
      reservations: [
        reservationRowFromFixture({
          access_verified: false,
          access_verified_at: null,
          guest_id: null,
        }),
      ],
    });

    const ctx = await resolveTelegramGuestBookingObjectContext({
      telegram_chat_id: 920001,
      text: 'Какой пароль от Wi-Fi?',
      db,
    });

    expect(ctx.wifi_verified).toBe(false);
    const reply = composeGuestWifiReplyRu({ property: ctx.property, verified: ctx.wifi_verified });
    expect(reply).toMatch(/уточните номер бронирования|телефон/i);
    expect(reply).not.toMatch(/test-wifi-nevsky24/);
  });

  it('never reveals door/access code in autopilot check-in reply without verification', async () => {
    const db = makeDb({
      properties: [propertyRowFromFixture()],
      reservations: [
        reservationRowFromFixture({
          access_verified: false,
          access_verified_at: null,
          guest_id: null,
        }),
      ],
    });

    const ctx = await resolveTelegramGuestBookingObjectContext({
      telegram_chat_id: 920001,
      text: 'Как заселиться?',
      db,
    });

    const fields = bookingObjectContextToAutopilotFields(ctx);
    expect(fields.object?.accessCode).toBeUndefined();

    const autopilot = decideCommunicationAutopilotResponse({
      channel: 'telegram',
      messageText: 'Как заселиться?',
      context: fields as any,
    });
    expect(autopilot.replyText ?? '').not.toMatch(/4829|домофон/i);
  });

  it('returns parking info when property context is resolved', async () => {
    const booking = await lookup_booking_by_telegram({
      telegram_chat_id: 920001,
      db: makeDb({ reservations: [reservationRowFromFixture()] }),
    });
    const property = await lookup_property_by_booking({
      booking,
      db: makeDb({ properties: [propertyRowFromFixture()] }),
    });

    const reply = composeGuestParkingReplyRu(property);
    expect(reply).toMatch(/Парковка/);
    expect(reply).toMatch(/бесплатная/);

    const autopilot = decideCommunicationAutopilotResponse({
      channel: 'telegram',
      messageText: 'Где можно припарковаться?',
      context: bookingObjectContextToAutopilotFields({
        booking,
        property,
        identity: null,
        booking_resolved: true,
        property_resolved: true,
        access_verified: true,
        wifi_verified: true,
        lookup_reason: 'booking_and_property',
      }) as any,
    });
    expect(autopilot.metadata.intent).toBe('parking');
    expect(autopilot.action).toBe('auto_reply');
    expect(autopilot.replyText).toMatch(/бесплатная/);
  });

  it('lookup_booking_by_identifier resolves by booking id and phone', async () => {
    const db = makeDb({ reservations: [reservationRowFromFixture()] });

    const byId = await lookup_booking_by_identifier({ booking_id: 'BK-TEST-TG-001', db });
    expect(byId?.reservation_id).toBe('test-res-tg-live');

    const byPhone = await lookup_booking_by_identifier({ phone: '79991234567', db });
    expect(byPhone?.guest_name).toBe('Тестовый Гость');
  });

  it('returns checkout time from property context', () => {
    const reply = composeGuestCheckoutReplyRu(TEST_PROPERTY);
    expect(reply).toMatch(/12:00/);
  });
});
