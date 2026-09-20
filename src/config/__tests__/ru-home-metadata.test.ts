import { afterEach, describe, expect, it, vi } from 'vitest';
import { RU_HOME_METADATA } from '../ruHomeMetadata';
import { metadata } from '@/app/ru/page';
import { generateMetadata } from '@/app/page';
const request = vi.hoisted(() => ({ host: 'asi-global.ru' }));
vi.mock('next/headers', () => ({ headers: () => new Headers({ host: request.host }) }));
vi.mock('next/navigation', () => ({ usePathname: () => '/ru' }));
afterEach(() => vi.unstubAllEnvs());
describe('RU homepage metadata source', () => {
  it('uses the same positioning and terms on the RU host root and /ru', async () => {
    vi.stubEnv('HOST_VARIANT', '');
    request.host = 'asi-global.ru';
    expect(metadata).toBe(RU_HOME_METADATA);
    expect(await generateMetadata()).toMatchObject(RU_HOME_METADATA);
    expect(metadata.title).toBe('ASI сама ведёт рутину ваших объектов');
    for (const term of ['Подключение бесплатно', '14 дней после готовности', 'только по вашему решению']) expect(metadata.description).toContain(term);
    expect(metadata.description).not.toMatch(/1(?:[\s\u00a0])?000 ₽|12 месяцев|Стригунова/);
  });
  it('also selects RU copy with the explicit local RU configuration', async () => {
    vi.stubEnv('HOST_VARIANT', 'ru');
    request.host = 'localhost';
    expect(await generateMetadata()).toMatchObject(RU_HOME_METADATA);
  });
  it('preserves international metadata on international hosts', async () => {
    vi.stubEnv('HOST_VARIANT', '');
    request.host = 'guestautopilot.com';
    const result = await generateMetadata();
    expect(result.title).toBe('ASI Global — Operations on autopilot. Humans on exceptions.');
    expect(result.description).toContain('ASI handles the daily work of physical businesses');
    expect(result.alternates).not.toHaveProperty('languages');
  });
});
