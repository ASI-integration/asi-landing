/**
 * Shared legal/entity data for footer, legal, offer, and privacy pages.
 */
export const legalConfig = {
  name: 'Реутова Юлия Игоревна',
  inn: '235307941957',
  email: 'Glaigmaltas@ya.ru',
  status: 'Самозанятый',
} as const;

/** One-line legal footer text for RU only: ИНН · Name */
export const legalFooterLine = `ИНН ${legalConfig.inn} · ${legalConfig.name}`;
