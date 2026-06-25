export const WIZARD_ACCEPTANCE_CRM_DISPLAY_NAME = 'Заявка автопроверки';

const WIZARD_ACCEPTANCE_NAME_PATTERN = /wizard\s*acceptance/i;
const WIZARD_ACCEPTANCE_USERNAME_PATTERN = /^wizard_accept(?:ance)?(?:_v\d+)?$/i;

export function formatCrmContactNameForDisplay(
  name: string,
  telegramUsername?: string | null,
): string {
  const normalizedName = String(name ?? '').trim();
  const username = String(telegramUsername ?? '').trim().replace(/^@+/, '');

  if (WIZARD_ACCEPTANCE_USERNAME_PATTERN.test(username)) {
    return WIZARD_ACCEPTANCE_CRM_DISPLAY_NAME;
  }

  if (WIZARD_ACCEPTANCE_NAME_PATTERN.test(normalizedName)) {
    return WIZARD_ACCEPTANCE_CRM_DISPLAY_NAME;
  }

  if (/^support[_\s-]?acceptance$/i.test(normalizedName)) {
    return 'Заявка автопроверки поддержки';
  }

  return normalizedName;
}

export function isWizardAcceptanceCrmContact(input: {
  name?: string | null;
  telegramUsername?: string | null;
  note?: string | null;
}): boolean {
  const name = String(input.name ?? '').trim();
  const username = String(input.telegramUsername ?? '').trim().replace(/^@+/, '');
  const note = String(input.note ?? '').toLowerCase();

  if (WIZARD_ACCEPTANCE_USERNAME_PATTERN.test(username)) return true;
  if (WIZARD_ACCEPTANCE_NAME_PATTERN.test(name)) return true;
  if (note.includes('acceptance_run') || note.includes('wizard_accept')) return true;
  return false;
}
