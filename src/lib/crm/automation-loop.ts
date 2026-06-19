export type CrmMissingDataAction = {
  field: string;
  label: string;
  setupStep: string;
  setupHref: string | null;
};

const FIELD_TO_SETUP_STEP: Array<{
  tokens: string[];
  label: string;
  setupStep: string;
}> = [
  { tokens: ['photo', 'photos', 'media', 'image'], label: 'Фото объекта', setupStep: 'photos' },
  { tokens: ['address', 'object.address', 'property.address', 'location'], label: 'Адрес объекта', setupStep: 'address' },
  { tokens: ['direction', 'directions', 'directionstext', 'access', 'accessnote'], label: 'Инструкции по заезду', setupStep: 'checkin' },
  { tokens: ['checkin', 'check_in', 'checkininstructions', 'check_in_instructions'], label: 'Инструкции по заезду', setupStep: 'checkin' },
  { tokens: ['wifipassword', 'wifi_password', 'password'], label: 'Пароль Wi-Fi', setupStep: 'wifi' },
  { tokens: ['wifi', 'wi-fi', 'wifiname', 'wifi_name'], label: 'Название Wi-Fi', setupStep: 'wifi' },
  { tokens: ['rules', 'house_rules', 'houserules'], label: 'Правила проживания', setupStep: 'rules' },
  { tokens: ['name', 'title', 'object.name', 'property.name'], label: 'Название объекта', setupStep: 'basic' },
];

function setupHref(propertyId: string | null | undefined, step: string): string | null {
  return propertyId ? `/dashboard/properties/${propertyId}/setup?step=${step}` : null;
}

function normalizeFieldToken(value: string): string {
  return value.trim().toLowerCase().replace(/[^a-z0-9_.-]/g, '');
}

function findMissingFieldDescriptor(field: string) {
  const normalized = normalizeFieldToken(field);
  return FIELD_TO_SETUP_STEP.find((item) => item.tokens.some((token) => normalized.includes(token)));
}

export function missingDataActionsForFields(
  fields: string[],
  propertyId?: string | null,
): CrmMissingDataAction[] {
  const byKey = new Map<string, CrmMissingDataAction>();

  for (const rawField of fields) {
    const field = rawField.trim();
    if (!field) continue;

    const descriptor = findMissingFieldDescriptor(field);
    const setupStep = descriptor?.setupStep ?? 'basic';
    const label = descriptor?.label ?? field;
    const key = `${setupStep}:${label}`;

    if (!byKey.has(key)) {
      byKey.set(key, {
        field,
        label,
        setupStep,
        setupHref: setupHref(propertyId, setupStep),
      });
    }
  }

  return [...byKey.values()];
}
