import type { BookingOpsPropertyKnowledge } from './types';
import type { PropertyKnowledgeInput } from './property-knowledge';

export const PROPERTY_KNOWLEDGE_INTAKE_FIELDS = [
  'propertyLabel',
  'address',
  'entranceInstructions',
  'floorApartment',
  'intercomCode',
  'keyPickupInstructions',
  'wifiName',
  'wifiPassword',
  'parkingInstructions',
  'houseRules',
  'quietHours',
  'checkoutInstructions',
  'emergencyInstructions',
  'cleaningLinenNotes',
  'publicGuestNotes',
  'privateOperatorNotes',
] as const;

export type PropertyKnowledgeIntakeField = (typeof PROPERTY_KNOWLEDGE_INTAKE_FIELDS)[number];
export type IntakeConfidence = 'high' | 'medium';
export type PropertyKnowledgeIntakeDraft = Partial<Record<PropertyKnowledgeIntakeField, string>>;

export type PropertyKnowledgeExtraction = {
  draft: PropertyKnowledgeIntakeDraft;
  confidence: Partial<Record<PropertyKnowledgeIntakeField, IntakeConfidence>>;
  warnings: string[];
  notFound: PropertyKnowledgeIntakeField[];
};

export const SENSITIVE_INTAKE_FIELDS = [
  'intercomCode',
  'keyPickupInstructions',
  'wifiPassword',
] as const satisfies readonly PropertyKnowledgeIntakeField[];

const SENSITIVE_SET = new Set<PropertyKnowledgeIntakeField>(SENSITIVE_INTAKE_FIELDS);

const LABELS: Array<{ field: PropertyKnowledgeIntakeField; patterns: RegExp[] }> = [
  { field: 'wifiPassword', patterns: [/^(?:пароль\s+(?:от\s+)?wi[ -]?fi|wi[ -]?fi\s+пароль|пароль\s+вайфая)$/iu] },
  { field: 'wifiName', patterns: [/^(?:название|имя|сеть|ssid)\s+wi[ -]?fi$/iu, /^(?:wi[ -]?fi|вайфай)$/iu] },
  { field: 'intercomCode', patterns: [/^(?:код\s+)?домофон(?:а)?$/iu, /^код\s+(?:двери|входа|подъезда)$/iu] },
  { field: 'keyPickupInstructions', patterns: [/^(?:получение|выдача)\s+ключ(?:а|ей)$/iu, /^(?:ключи|локбокс|код\s+локбокса|смарт[- ]?замок|умный\s+замок)$/iu] },
  { field: 'address', patterns: [/^(?:адрес|местоположение)$/iu] },
  { field: 'entranceInstructions', patterns: [/^(?:как\s+(?:войти|попасть)|вход|инструкции?\s+(?:по\s+)?входу|подъезд)$/iu] },
  { field: 'floorApartment', patterns: [/^(?:этаж(?:\s*\/\s*квартира)?|квартира)$/iu] },
  { field: 'parkingInstructions', patterns: [/^(?:парковка|паркинг)$/iu] },
  { field: 'houseRules', patterns: [/^(?:правила|правила\s+проживания|правила\s+дома)$/iu] },
  { field: 'quietHours', patterns: [/^(?:тихие\s+часы|время\s+тишины|тишина)$/iu] },
  { field: 'checkoutInstructions', patterns: [/^(?:выезд|инструкции?\s+(?:по\s+)?выезду|что\s+сделать\s+при\s+выезде)$/iu] },
  { field: 'emergencyInstructions', patterns: [/^(?:экстренная\s+связь|экстренные\s+контакты|аварийные\s+контакты|контакты|что\s+делать\s+в\s+экстренной\s+ситуации)$/iu] },
  { field: 'cleaningLinenNotes', patterns: [/^(?:уборка|белье|бельё|уборка\s+и\s+бель[её])$/iu] },
  { field: 'publicGuestNotes', patterns: [/^(?:заметки\s+для\s+гостя|гостевые\s+заметки|важно\s+для\s+гостя)$/iu] },
  { field: 'privateOperatorNotes', patterns: [/^(?:внутренние\s+заметки|заметки\s+оператора|только\s+для\s+оператора)$/iu] },
  { field: 'propertyLabel', patterns: [/^(?:название\s+объекта|объект)$/iu] },
];

function normalizeValue(value: string): string {
  return value.replace(/\r/g, '').trim().replace(/\n{3,}/g, '\n\n');
}

function identifyLabel(label: string): PropertyKnowledgeIntakeField | null {
  const normalized = label.trim().replace(/[.\s]+$/u, '');
  return LABELS.find(({ patterns }) => patterns.some((pattern) => pattern.test(normalized)))?.field ?? null;
}

function addValue(
  draft: PropertyKnowledgeIntakeDraft,
  field: PropertyKnowledgeIntakeField,
  value: string,
): void {
  const normalized = normalizeValue(value);
  if (!normalized) return;
  draft[field] = draft[field] ? `${draft[field]}\n${normalized}` : normalized;
}

export function redactPropertyKnowledgeIntakeText(rawText: string): string {
  return rawText
    .replace(/((?:пароль\s+(?:от\s+)?wi[ -]?fi|wi[ -]?fi\s+пароль|пароль\s+вайфая)\s*[:\-–—]\s*)[^\r\n]+/giu, '$1[СКРЫТО]')
    .replace(/((?:код\s+)?(?:домофон(?:а)?|двери|входа|подъезда|локбокса)\s*[:\-–—]\s*)[^\r\n]+/giu, '$1[СКРЫТО]')
    .replace(/((?:локбокс|смарт[- ]?замок|умный\s+замок)[^\r\n:]*[:\-–—]\s*)[^\r\n]+/giu, '$1[СКРЫТО]');
}

export function extractPropertyKnowledge(rawText: string): PropertyKnowledgeExtraction {
  const raw = rawText.trim();
  const draft: PropertyKnowledgeIntakeDraft = {};
  const confidence: PropertyKnowledgeExtraction['confidence'] = {};
  const warnings: string[] = [];

  if (!raw) {
    return {
      draft,
      confidence,
      warnings: ['Вставьте текст с данными объекта.'],
      notFound: [...PROPERTY_KNOWLEDGE_INTAKE_FIELDS],
    };
  }

  let activeField: PropertyKnowledgeIntakeField | null = null;
  for (const sourceLine of raw.replace(/\r/g, '').split('\n')) {
    const line = sourceLine.trim().replace(/^[•*]\s*/u, '');
    if (!line) {
      activeField = null;
      continue;
    }

    const labelled = line.match(/^(.{1,80}?)(?::|\s[\-–—]\s)(.*)$/u);
    const field = labelled ? identifyLabel(labelled[1]) : null;
    if (field) {
      const labelledValue = labelled?.[2] ?? '';
      if (field === 'wifiName') {
        const combined = labelledValue.match(/^(.*?)[,;]\s*(?:пароль|password)\s*[:\-–—]?\s*(.+)$/iu);
        if (combined) {
          addValue(draft, 'wifiName', combined[1]);
          addValue(draft, 'wifiPassword', combined[2]);
          confidence.wifiPassword = 'high';
        } else {
          addValue(draft, field, labelledValue);
        }
      } else {
        addValue(draft, field, labelledValue);
      }
      confidence[field] = 'high';
      activeField = field;
      continue;
    }

    if (activeField) addValue(draft, activeField, line);
  }

  const wifiCombined = raw.match(/(?:wi[ -]?fi|вайфай)\s*[:\-–—]\s*([^\n,;]+?)(?:\s*[,;]\s*|\s+)(?:пароль|password)\s*[:\-–—]?\s*([^\s,;]+)/iu);
  if (wifiCombined) {
    if (!draft.wifiName) {
      draft.wifiName = normalizeValue(wifiCombined[1]);
      confidence.wifiName = 'medium';
    }
    if (!draft.wifiPassword) {
      draft.wifiPassword = normalizeValue(wifiCombined[2]);
      confidence.wifiPassword = 'medium';
    }
  }

  const extractedFields = PROPERTY_KNOWLEDGE_INTAKE_FIELDS.filter((field) => Boolean(draft[field]));
  if (extractedFields.length === 0) {
    warnings.push('Не удалось уверенно распознать разделы. Добавьте понятные подписи, например «Адрес:» или «Парковка:».');
  }
  if (extractedFields.some((field) => SENSITIVE_SET.has(field))) {
    warnings.push('Найдены коды или пароль. Проверьте защищённые значения перед сохранением.');
  }

  return {
    draft,
    confidence,
    warnings,
    notFound: PROPERTY_KNOWLEDGE_INTAKE_FIELDS.filter((field) => !draft[field]),
  };
}

function currentValue(
  existing: BookingOpsPropertyKnowledge | null,
  field: PropertyKnowledgeIntakeField,
): string {
  return String(existing?.[field] ?? '').trim();
}

export function mergePropertyKnowledgeIntake(input: {
  propertyId: string;
  draft: PropertyKnowledgeIntakeDraft;
  approvedFields: PropertyKnowledgeIntakeField[];
  confirmedSensitiveFields?: PropertyKnowledgeIntakeField[];
  existing?: BookingOpsPropertyKnowledge | null;
}): {
  input: PropertyKnowledgeInput;
  changedFields: PropertyKnowledgeIntakeField[];
  skippedFields: PropertyKnowledgeIntakeField[];
  sensitiveConflicts: PropertyKnowledgeIntakeField[];
} {
  const approved = new Set(input.approvedFields);
  const confirmedSensitive = new Set(input.confirmedSensitiveFields ?? []);
  const merged: PropertyKnowledgeInput = { propertyId: input.propertyId };
  const changedFields: PropertyKnowledgeIntakeField[] = [];
  const skippedFields: PropertyKnowledgeIntakeField[] = [];
  const sensitiveConflicts: PropertyKnowledgeIntakeField[] = [];

  for (const field of PROPERTY_KNOWLEDGE_INTAKE_FIELDS) {
    if (!approved.has(field)) continue;
    const value = String(input.draft[field] ?? '').trim();
    if (!value) {
      skippedFields.push(field);
      continue;
    }
    const current = currentValue(input.existing ?? null, field);
    if (SENSITIVE_SET.has(field) && current && current !== value && !confirmedSensitive.has(field)) {
      sensitiveConflicts.push(field);
      skippedFields.push(field);
      continue;
    }
    if (current === value) continue;
    merged[field] = value;
    changedFields.push(field);
  }

  return { input: merged, changedFields, skippedFields, sensitiveConflicts };
}
